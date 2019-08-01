// ==UserScript==
// @name yt-mixlist
// @namespace kawa.tf
// @description Displays the currently playing track in a mix with a tracklist
// @version 0.0.2
// @match *://*.youtube.com/*
// @license GPL-3.0-or-later
// ==/UserScript==

/* Match on youtube.com in general as YouTube handles links dynamically
 * See https://developer.chrome.com/extensions/match_patterns
 * for the specific globbing
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


/* Logging */

function log (s) {
	console.log(`${script_name}: ${s}`);
}
function hi() { log("hi"); }  // Used for debug
function log_video (id) { log(`Video id: ${id}`); }



/* Utilities */

let once_then_listenOn = function (eventname, func, validate) {
	if (validate === undefined) validate = (x => x);

	let callback = {}; // Declare it here so that we can create the destructor function
	let destructor = function () {
		window.removeEventListener(eventname, callback);
	};

	let promi = new Promise(function (resolve, reject) {
		let ret = func();
		if (validate(ret)) {
			resolve(ret);
			return;
		}

		// Failed, so let's loop
		callback = function () {
			let ret = func();
			if (validate(ret)) {
				resolve(ret);
				destructor();
				return;
			}
		};
		window.addEventListener(eventname, callback);
	});

	return {promise: promi, destroy: destructor};
}


// a: Array
var findLastIndex = function (a, func) {
	// ri = reverse index
	let ri = a.slice().reverse().findIndex(func);
	let count = a.length - 1
	let i = ri >= 0 ? count - ri : ri;
	return i;
}



/* YouTube */

// Get the video id from an url. Returns null on error
let getIdFromUrl = function (url) {
	let re = /\/watch\?(?:.+&)?v=([^&]+)(?:#|&|$)/;
	let result = url.match(re);
	return (result === null ? null : result[1]);
}
let getCurrentVideoId = function () {
	return getIdFromUrl(location.href);
}



/* Events */

// Creates the 'DOMmutation' event
{let DOMmutation = function () {
	let callback = function (mutationList, observer) {
		let evt = new Event('DOMmutation');
		window.dispatchEvent(evt);
	};
	let mo = new MutationObserver(callback);
	mo.observe(document.body, {childList: true, subtree: true});
}()}

// Creates the 'locationchange' event based on the 'DOMmutation' event loop
{let LocationWatcher = function () {
	let last_url = location.href; // init

	let callback = function () {
		let current_url = location.href;
		if (current_url !== last_url) {
			last_url = current_url;

			let detail = {
				url: current_url
			};
			let evt = new CustomEvent('locationchange', {detail: detail});
			window.dispatchEvent(evt);
		}
	}
	window.addEventListener('DOMmutation', callback);
}()}

// Creates the 'videoidchange' event based on the 'locationchange' event loop
{let VideoIdWatcher = function () {
	let last_video_id = getCurrentVideoId();

	let callback = function (e) {
		let current_video_id = getIdFromUrl(e.detail.url);
		if (last_video_id !== current_video_id) {
			last_video_id = current_video_id;

			let detail = {
				id: current_video_id
			};
			let evt = new CustomEvent('videoidchange', {detail: detail});
			window.dispatchEvent(evt);
		}
	}

	window.addEventListener('locationchange', callback);
}()}



/* Stylesheet */

let existsStyleSheet = function () {
	return document.getElementById(style_id) !== null;
}

let includeStyleSheet = function () {
	let ss = document.createElement('style');
	ss.textContent = script_css;
	ss.setAttribute('id', style_id);
	document.head.appendChild(ss);
}

// Make sure the stylesheet exists
let ensureStyleSheet = function () {
	// No fail check
	if (!existsStyleSheet()) includeStyleSheet();
}



/* DOM elements */

// result = {
//	 player: element with API,
//	 valid: does it have the needed API
// }
let getPlayer = function () {
	return player = document.getElementById('movie_player');
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
	return (selected.length == 0 ? null : selected[0]);
}

// result = element containing the first pinned comment text || null
let getPinnedComment  = function () {
	let pinc = document.querySelector('#pinned-comment-badge:not([hidden])');
	if (pinc === null ) { return null; }

	// Find common ancestor
	let elt = pinc.closest('#main');
	if (elt === null) { return null; }

	let text = elt.querySelector('#content-text');
	return text;
}


/* Element checks */

let noPinnedComments = function () {
	return (document.getElementsByTagName('ytd-comment-thread-renderer').length > 0
		&& getPinnedComment() === null);
}

// Checks if the player is valid
let isPlayerValid = function (player) {
	let valid = true;
	// Check if the required functions exist
	let props = ["getDuration", "getCurrentTime"];
	for (let prop of props) {
		if (!(prop in player)) {
			valid = false;
			break;
		}
	}

	return valid;
}




/* Tracklist parsing */

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


let TracklistFinder = new EventTarget();
{
	// proto elements as returned by once_then_listenOn, for getting the description, getting the pinned comment, and stopping the search for a pinned comment.
	let protoDescription;
	let protoPinned;
	let protoNoComments;

	TracklistFinder.run = function () {
		// Find the description which always exists, and maybe a pinned comment.
		// Use protoNoComments to stop the search for a pinned comments where the comments are loaded but there aren't any pinned
		let protoDescription = once_then_listenOn('DOMmutation', getDescription);
		let protoPinned = once_then_listenOn('DOMmutation', getPinnedComment);
		let protoNoComments = {}; // To stop looking for the pinned comment when it doesn't exist

		protoDescription.promise.then(desc => {
			log ("Found description");
			let evt = new CustomEvent('element', {detail:
				{elt: desc, source: 'description'}
			});
			TracklistFinder.dispatchEvent(evt);
		});

		protoPinned.promise.then(comment => {
			log ("Found pinned comment");
			let evt = new CustomEvent('element', {detail:
				{elt: comment, source: 'comment'}
			});
			TracklistFinder.dispatchEvent(evt);
			protoNoComments.destroy();
		});

		protoNoComments = once_then_listenOn('DOMmutation', function () {
			if (noPinnedComments()) {
				log("No pinned comments")
				protoPinned.destroy();
				protoNoComments.destroy();
			}
		});
	};

	// Destroy all finders if they are running
	TracklistFinder.stop = function () {
		let objects = [protoDescription, protoPinned, protoNoComments];

		for (let obj of objects) {
			if (obj !== undefined && 'destroy' in obj) {
				obj.destroy();
			}
		}
	};
}


/* Display */

let TracklistDisplay = {};
{
	let display;

	let getDisplay = function () {
		return document.getElementById(display_id);
	}

	TracklistDisplay.exists = function () {
		// Try to grab it from the document
		if (!display) getDisplay();

		return Boolean(display);
	}

	let createDisplay = function () {
		display = document.createElement('div');
		display.id = display_id;
		display.classList.add(display_css_class);

		// Place it after the views
		once_then_listenOn('DOMmutation', getViewsDiv)
		.promise.then(value => {
			let clonedFlex = getFlexDiv().cloneNode(false);
			// Why not, but leave the id intact for the YouTube CSS
			clonedFlex.classList.add(`${script_name}-clone`);

			value.insertAdjacentElement('afterend', display);
			display.insertAdjacentElement('beforebegin', clonedFlex);
		});
	};

	TracklistDisplay.create = function () {
		if (!getDisplay()) createDisplay();
	};

	TracklistDisplay.setText = function (newText) {
		if (!TracklistDisplay.exists()) return;

		display.textContent = newText;
	};

}



let TracklistUpdater = {};
{
	let player = null;
	let tracklist = null;
	let source = null;
	let interval_id = null; // is set when it is running

	/* Data functions */

	TracklistUpdater.setPlayer = function (new_player) {
		player = new_player;
	};

	TracklistUpdater.reset = function () {
		let objects = [player, tracklist, source, interval_id]
		clearInterval(interval_id);

		for (let obj of objects) {
			obj = null;
		}
	}

	let setTracklist = function (tr, src) {
		tracklist = tr;
		source = src || null;
	};

	// TODO store all potential tracklists for user selection
	TracklistUpdater.offerTracklist = function (tr, src) {
		if (!tracklist) {
			setTracklist(tr, src);
		} else {
			if (src) {
				if ( true /* TODO they are about the same length*/
					&& (src === 'comment' && source == 'description'))
				{ setTracklist(tr, src); }
			} else {
				if (false /* check if tr is longer than tracklist */ ) {
					setTracklist(tr);
				}
			}
		}
	};

	/* Functions to run it */

	let update = function () {
		if (!(player !== null && tracklist !== null)) return;
		let time = player.getCurrentTime();
		let i = findLastIndex(tracklist, v => (v.seconds <= time) );
		let newText = tracklist[i].title;
		TracklistDisplay.setText(newText);
	};

	TracklistUpdater.isRunning = function () {
		return Boolean(interval_id);
	}

	// Singleton pattern
	TracklistUpdater.run = function () {
		if (TracklistUpdater.isRunning()) return;

		interval_id = setInterval (update, 500);
		log("Started time cursor");
	};
}





// This is a scope/object containing the main logic
let MixList = {};
{
	MixList.setup = function () {
		// TracklistFinder <-> TracklistUpdater
		TracklistFinder.addEventListener('element', function (e) {
			let tracklist = parseForTracklist(e.detail.elt);
			TracklistUpdater.offerTracklist(tracklist, e.detail.source);
		});
	}

	MixList.shoot = function (id) {
		TracklistUpdater.reset();
		TracklistFinder.stop();

		let protoPlayer = once_then_listenOn('DOMmutation', getPlayer);
		protoPlayer.promise
		.then( player => {
			log("Found player");

			TracklistUpdater.setPlayer(player);

			TracklistDisplay.create();
			TracklistFinder.run();
			TracklistUpdater.run();
		});
	};
}



async function main() {
	log("Started");

	MixList.setup();

	/* Change handlers */
	window.addEventListener('videoidchange', e => MixList.shoot(e.detail.id) );
	window.addEventListener('videoidchange', e => log_video(e.detail.id) );


	/* First run */
	let id = getCurrentVideoId();
	MixList.shoot(id);
	log_video(id);

	log("Done init");

	/* Debug */
	TracklistFinder.addEventListener('element', e => console.log(e.detail.elt));
}

main();

})();
// vim: fdm=indent fdc=2
