// ==UserScript==
// @name yt-mixlist
// @namespace kawa.tf
// @description Displays the currently playing track in a mix with a tracklist
// @version 0.0.1
// @match *://*.youtube.com/*
// @license GPL-3.0-or-later
// ==/UserScript==

/* Match on youtube.com in general as YouTube handles links dynamically
 * See https://developer.chrome.com/extensions/match_patterns
 * for the specific globbing
 */


/*
tryRepeatedly is used when you're relying on elements that are
loaded aynchronously, for example the YouTube player, its description, metadata,
comments, etc…
*/


/* Roadmap:
- Test it on more types of tracklists
- Handle document.location change
- tryRepeatedly could follow a function for frequency. Maybe use the derivative
  of the timing function for timeout value
  - that's because comments are loaded dynamically, I don't know how frequently
    to check them
  - An option to stop the tryRepeatedly would be nice too. maybe encapsulate it
    in a object (which would act a scope) so you can send messages to it
- Add Animations for track changing, and maybe anticipate it
- Add a progress bar for it
- Change when the display appears (because you can currently see
  a weird pink rectangle)
- handle multiple pinned comment, or tracklist in comment
  - Handle timestamp ranges
  - Handle oneline tracklists
*/



(function () {
'use strict';

/* Constants */
const script_name = 'yt-mixlist'
const display_id = script_name + '-display';
const style_id = script_name + '-style';
const display_css_class = script_name + '-display';
const script_css =`
.${display_css_class} {
    border: 0.2rem solid pink;
    padding: 0 0.2rem;
    margin: 0 0.5rem;
    font-size: 1.8rem;
    color: var(--yt-spec-text-primary, steelblue);
}
`;

/* Globals */
let display;  // The main container
let player;  // The YouTube player that has API methods
let tracklist;
let status = {
    description: {
        found: undefined,
        parsed: false,
    },
    pinc: {
        found: undefined,
        parsed: false,
    },
};


function log (s) {
    console.log(script_name + ": " + s);
}
function log_video (id) {
    if (id === null) {
        log ("This page should not have a video player");
    } else {
        log("Video id is " + id);
    }
}
function hi() { log("hi"); }  // Used for debug



/* Utilities */

// return = promise on the return of $testfunc
//          which is called every $delay at most $max times
// Default is to try 10 times in 1 second
// $testfunc 's failure should be null unless specified otherwise
// To test undefinedness, use 'undefined'
var tryRepeatedly = function (testfunc, max, delay, failure) {
    // Defaults
    max = max || 10;
    delay = delay || 100;  // 100ms
    if (failure === undefined) { failure = null; }
    else if (failure === "undefined") { failure = undefined; }

    let executor = function (resolve, reject) {
        let count = 0;
        let name = testfunc.name || "<anonymous function>";

        let func = function () {
            if (count >= max) {
                clearInterval(id);
                log(`Timeout reached for tryRepeatedly(${name}, ${max}, ${delay})`);
                reject ("Timed out");
            } else {
                log(`tryRepeatedly: Attempt #${count} for ${name}`);

                let ret = testfunc();
                if (ret !== failure) {
                    clearInterval(id);
                    resolve (ret);
                }
                count++;
            }
        };
        let id = setInterval(func, delay);
    };

    return new Promise (executor);
}


// a: Array
var findLastIndex = function (a, func) {
    // ri = reverse index
    let ri = a.slice().reverse().findIndex(func);
    let count = a.length - 1
    let i = ri >= 0 ? count - ri : ri;
    return i;
}



/* Fetch DOM elements */

// result = {
//     player: element with API,
//     valid: does it have the needed API
// } || null
let getPlayer = function () {
    let player = document.getElementById('movie_player');
    if (player === null) { return null; }
    let valid = true;

    // Check if the required functions exist
    let props = ["getDuration", "getCurrentTime"];
    for (let prop of props) {
        if (!(prop in player)) {
            valid = false;
            break;
        }
    }

    return {player, valid};
}

// result = previous sibling of where the display should go || null
let getViewsDiv = function () {
    return document.querySelector('#info-text.ytd-video-primary-info-renderer');
}

// result = flex growing thing || null
let getFlexDiv = function () {
    return document.querySelector('#flex.ytd-video-primary-info-renderer');
}

// result = element containing description text || null
let getDescription = function () {
    let selected = document.getElementsByClassName('ytd-video-secondary-info-renderer content');
    if (selected.length == 0) { return null; }
    return selected[0];
}

// result = element containing the first pinned comment text || null
let getPinnedComment  = function () {
    let pinc = document.getElementById('pinned-comment-badge');
    if (pinc === null ) { return null; }

    // Find common ancestor
    let elt = pinc.closest('#main');
    if (elt === null) { return null; }

    let text = elt.querySelector('#content-text');
    return text;
}


/* Create DOM elements */

/* > First, the stylesheet */
let existsStyleSheet = function () {
    return document.getElementById(style_id) !== null;
}

let includeStyleSheet = function () {
    let ss = document.createElement('style');
    ss.textContent = script_css;
    ss.setAttribute('id', style_id);
    document.head.appendChild(ss);
}



// stores the diplay in the global variable $display
let createDisplay = function () {
    // Check if it exist first
    let found = document.getElementById(display_id);
    if (found) { display = found; return; };

    // Otherwise, create the element
    display = document.createElement('div');
    display.id = display_id;
    display.classList.add(display_css_class);
    // Place it after the views
    tryRepeatedly(getViewsDiv)
    .then(value => {
        let clonedFlex = getFlexDiv().cloneNode(false);
        // Why not, but leave the id intact for the YouTube CSS
        clonedFlex.classList.add(`${script_name}-clone`);

        value.insertAdjacentElement('afterend', display);
        display.insertAdjacentElement('beforebegin', clonedFlex);
    });
}



/* Logic */

// result = [{title: , timestamp: , seconds: }, …] sorted by seconds || null
let parseForTracklist = function (elt) {
    /* Unused because I can't seem to find a use for the fact that the word
     * tracklist exists or not
    let lines = elt.innerHTML.split('\n');
    // Assumes there's only one tracklist, which is the first one
    let tracklist_index = lines.findIndex(e => /tracklist/i.test(e));
    */

    // Find all timestamps
    let links = elt.getElementsByTagName('a');
    links = Array.from(links).filter( v => /watch\?.*&t=./.test(v.href) );
    if (links.length == 0) { return null; }

    // Get the line containing the timestamp
    let trackObjects = links.map(function (v) {
        let prefix = "";
        let suffix = "";

        let prev = v.previousSibling;
        if (prev !== null) {
            prefix = prev.textContent.split('\n').pop();
        }

        let next = v.nextSibling;
        if (next !== null) {
            suffix = next.textContent.split('\n').shift();
        }

        let startIndex = v.href.search(/&t=/);  // guaranteed by filter
        startIndex += "&t=".length;
        let endIndex = v.href.indexOf('s', startIndex);
        let seconds = v.href.slice(startIndex, endIndex);

        return {prefix, timestamp: v.textContent, suffix, seconds};
    });

    // Remove leading track number if it exists
    trackObjects.forEach(function (v) {
        v.prefix = v.prefix.trim().replace(/^\d+[.)]/, "").trim();
    });

    // Remove surrounding parentheses or square brackets
    let removeSurrounding = function (v, opening, closing) {
        if (v.prefix.length > 0 && v.prefix.slice(-1) === opening
            && v.suffix.length > 0 && v.suffix.charAt(0) === closing) {
            v.prefix = v.prefix.slice(0, -1);
            v.suffix = v.suffix.slice(1);
        }
    }
    trackObjects.forEach(function(v) {
        removeSurrounding(v, '[', ']');
        removeSurrounding(v, '(', ')');
        v.prefix = v.prefix.trim();
        v.suffix = v.suffix.trim();
    });

    // Choose the longest string between prefix and suffix
    let titles = trackObjects.map(function (v) {
        let s;
        if (v.prefix.length > v.suffix.length) {
            s = v.prefix;
        } else {
            s = v.suffix;
        }

        return {title: s, timestamp: v.timestamp, seconds: v.seconds};
    });

    // Sort by seconds
    titles.sort( (a, b) => Math.sign(a.seconds - b.seconds) );

    return titles;
}


let findTracklist = function () {
    // Something something tracklist already exists and both have been parsed.
    let result = null;

    if (!status.description.found) {
        let desc = getDescription();
        if (desc === null) {
            if (status.description.found === undefined) {
                log("Could not find description");
                status.description.found = false;
            }
        } else {
            log("Found description");
            result = parseForTracklist(desc);
            status.description.found = true;
        }
    }

    if (!status.pinc.found) {
        let pinc = getPinnedComment();
        if (pinc === null) {
            if (status.pinc.found === undefined) {
                log("Could not find pinned comment");
                status.pinc.found = false;
            }
        } else {
            log("Found pinned comment");
            let r = parseForTracklist(pinc);

            // Use the pinned comment tracklist over the description's
            if (r !== null) {
                result = r;
            }
            status.pinc.found = true;
        }
    }

    return result;
}


let createTrackUpdater = function () {
    var updateTrack = function() {
        let time = player.getCurrentTime();
        let i = findLastIndex(tracklist, v => v.seconds <= time );
        let newText = tracklist[i].title;
        if (display.textContent != newText) {
            display.textContent = newText;
        }
    };
    let id = setInterval (updateTrack, 500);
    log(`Interval ID: ${id}`);
}


// This is a scope/object
// Removing listeners is not implemented, might do it with ids.
// Only a single interval is allowed
function LocationWatcher () {
    let callbacks = [];
    let url = null;
    let timer_id = null;

    let checkUrl = function () {
        let u = location.href;
        if (u != url) {
            url = u;
            for (let c of callbacks) {
                c (url);
            }
        }
    }

    // default delay of 200ms
    this.start = function (delay) {
        if (timer_id !== null) {
            this.stop();
        }

        if (delay === undefined) {
            delay = 200;  // ms
        }

        url = location.href;
        timer_id = setInterval(checkUrl, delay);
    }

    this.stop = function () {
        if (timer_id !== null) {
            clearInterval(timer_id);
            timer_id = null;
        }
    }

    // f will be called with the new url as first argument
    this.addCallback = function (f) {
        callbacks.push(f);
    }
}


// result = id string || null
let getIdFromUrl = function (url) {
    let start = url.indexOf("/watch?");
    if (start == -1) return null;
    start = url.indexOf("v=", start);
    if (start == -1) return null;
    start += "v=".length;

    let end = url.indexOf("&", start);
    if (end == -1) end = url.length;

    return url.substring(start, end);
}

// result = id string || null
let getCurrentVideoId = function () {
    return getIdFromUrl(location.href);
}

// This is a scope/object
// Removing listeners is not implemented, might do it with ids.
function VideoIdWatcher () {
    let video_id = null;
    const lw  = new LocationWatcher();
    let callbacks = [];

    let checkId = function (url) {
        let newVideoId = getIdFromUrl(url);

        if (newVideoId != video_id) {
            video_id = newVideoId;
            for (let c of callbacks) {
                c (video_id);
            }
        }
    }

    // default delay of 200ms
    this.start = function (delay) {
        if (delay === undefined) {
            delay = 200;  // ms
        }

        video_id = getCurrentVideoId();
        lw.addCallback(checkId);
        lw.start(delay);
    }

    this.stop = function () {
        lw.stop();
    }

    // f will be called with the new video id as first argument
    this.addCallback = function (f) {
        callbacks.push(f);
    }
}


// This is a scope/object containing the main logic
function MixList () {

    let last_id = null;

    this.shoot = function (id) {
        if (typeof id === 'undefined') {
            id = getCurrentVideoId();
        }

        if (id === null) {
            // Maybe do something with last_id
            // kill previous display and updater if they exist
            // Do nothing else as this is not a video
            return;
        }

        // Maybe add a delay, it's important, but it can work without it
        if (document.head !== null && !existsStyleSheet()) {
            includeStyleSheet();
        }

        let gotPlayer = tryRepeatedly (getPlayer);
        gotPlayer.then( value => {
            // Player exists
            log("Found player");
            player = value.player;
            return tryRepeatedly(findTracklist, 50, 200);
        },
        error => { log("Could not find player."); })

        .then( value => {
            // Tracklist found
            log("Found tracklist");
            tracklist = value;
            console.log(tracklist);
            createDisplay();
            log("Created display");
            createTrackUpdater();
        },
        error => { log("Could not find tracklist"); });
    }
}


/* Init and setup */
async function main() {
    log("Started");

    let ml = new MixList();
    let viw = new VideoIdWatcher();

    viw.addCallback(id => log_video(id));
    viw.addCallback(ml.shoot);

    log_video(getCurrentVideoId());
    ml.shoot();

    viw.start();

    log("Done");
}



/* Run it ! */

main();

})();


// vim: fdm=indent fdc=2
