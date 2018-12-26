// ==UserScript==
// @name yt-mixlist
// @namespace kawa.tf
// @description Displays the currently playing track in a mix with a tracklist
// @version 0.0.1
// @match http://www.youtube.com/watch*
// @match https://www.youtube.com/watch*
// @license GPL-3.0-or-later
// ==/UserScript==

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

*/



(function () {
/* Constants */
const script_name = 'yt-mixlist'
const display_id = script_name + '-display';
const display_css_class = script_name + '-display';
const script_css = `
.${display_css_class} {
    border: 0.2rem solid pink;
    padding: 0 0.2rem;
    margin: 0 0.5rem;
    font-size: 1.8rem;
    color: var(--yt-spec-text-primary, steelblue);
}
`;


/* Globals */
var display;  // The main container
var player;  // The YouTube player that has API methods
var tracklist;
var status = {
    description: {
        found: undefined,
        parsed: false,
    },
    pinc: {
        found: undefined,
        parsed: false,
    },
};


/* Informational */

function log(s) {
    console.log(script_name + ": " + s);
}
// Used for debug
function hi() { log("hi"); }



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
//              player element with API,
//              validity of the element
//          } || null
var getPlayer = function () {
    let player = document.getElementById('movie_player');
    if (player === null) { return null; }
    let valid = true;

    // Check if the required functions exist
    props = ["getDuration", "getCurrentTime"];
    for (prop in props) {
        if (!(prop in player)) {
            break;
        }
    }

    return {player, valid};
}


// result = sibling of where the display should go || null
var getViewsDiv = function () {
    return document.querySelector('#info-text.ytd-video-primary-info-renderer');
}


// result = flex growing thing || null
var getFlexDiv = function () {
    return document.querySelector('#flex.ytd-video-primary-info-renderer');
}


// result = element containing description text || null
var getDescription = function () {
    let selected = document.getElementsByClassName('ytd-video-secondary-info-renderer content');
    if (selected.length == 0) { return null; }
    return selected[0];
}


// result = element containing the pinned comment text || null
var getPinnedComment = function () {
    let pinc = document.getElementById('pinned-comment-badge');
    if (pinc === null ) { return null; }

    // Find common ancestor
    let elt = pinc.closest('#main');
    if (elt === null) { return null; }

    let text = elt.querySelector('#content-text');
    return text;
}



/* Create DOM elements */

var includeStyleSheet = function() {
    let ss = document.createElement('style');
    ss.innerHTML = script_css;
    document.head.appendChild(ss);
}

// stores the diplay in the global variable $display
var createDisplay = function () {
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
var parseForTracklist = function (elt) {
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


var findTracklist = function () {
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


var createTrackUpdater = function () {
    var updateTrack = function() {
        let time = player.getCurrentTime();
        let i = findLastIndex(tracklist, v => v.seconds <= time );
        let newText = tracklist[i].title;
        if (display.innerHTML != newText) {
            display.innerHTML = newText;
        }
    };
    let id = setInterval (updateTrack, 500);
    log(`Interval ID: ${id}`);
}


async function main () {
    log("Started");

    includeStyleSheet();

    let gotPlayer = tryRepeatedly (getPlayer);
    gotPlayer.then( value => {
        // Player exists
        log("Found player");
        player = value.player;
        createDisplay();
        log("Created display");
        return tryRepeatedly(findTracklist, 50, 200);
    },
    error => { log("Could not find player."); })

    .then( value => {
        // Tracklist found
        log("Found tracklist");
        tracklist = value;
console.log(tracklist);
        createTrackUpdater();
    },
    error => { log("Could not find tracklist"); })
    ;


    log("Got to the end");
}



/* Run it ! */

main();

})();
