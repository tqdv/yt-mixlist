# Overview

The following (should) correspond to the source code.

We…

## Logging

`log` prints the string to console with the script name prefixed.
`hi` prints "$script_name: hi" to the console.
`log_video (id)` logs the id  to the console.

## Utilities

### once_then_listenOn

`once_then_listenOn (eventname, func, validate)` returns an object `ret`.  
`ret.promise` is the promise for the valid return value of `func`.  
`ret.destroy` stops the `func` from being executed at each `eventname` event.  
It calls `func` once, and if the result is validated by `validate` (defaults to the identity function), returns it. Otherwise, it registers a handler (on window) for the eventname and runs func everytime that event is triggered. If returns the promise when it succeeds.
You can stop the event listener by calling `.destroy` on the object it returns.

`findLastIndex (a, func)` returns the last index of the element of a that passes func.

## YouTube

`getIdFromUrl` takes a YouTube video url string and returns its video id string. It returns `null` on failure.
`getCurrentVideoId` returns the video id of the current page, returns `null` if there isn't one.

## Events

[`DOMmutation`]
Adds a `DOMmutation` event based on MutationObserver.

[`LocationWatcher`]
Adds a 'locationchange' CustomEvent which is triggered when there is a location change between 'DOMmutation' events. Its `.detail.url` contains the new URL.


[`VideoIdWatcher`]
Adds a 'videoidchange' CustomEvent that is triggered when the video id has been changed between 'locationchange' events. (uses `getIdFromUrl`). `.detail.id` contains the video id if applicable, null otherwise.

## Stylesheet

`existsStyleSheet` checks if the script stylesheet exists in the document.
`includeStyleSheet` adds a script stylesheet to the document.
`ensureStyleSheet` makes sure the stylesheet is present in the document.

## DOM elements

The following functions are "aliases" for DOM queries: `getPlayer`, `getViewsDiv`, `getFlexDiv`, `getDescription` and `getPinnedComment`.

## Element checks

`noPinnedComments` returns a boolean for the absence of a pinned comment.
`isPlayerValid (player)` checks if the player is valid.

## Tracklist parsing

`parseForTracklist (elt)` takes the element that contains the links and text content and tries to extract a playlist from it as %TODO%.

## "Objects"

### TracklistFinder

Handles finding the tracklists and choosing which one to give to the display

Inherits from *EventTarget*.
Use `.run()` to start the search for tracklists in the YouTube video page.
It triggers the 'element' event when it finds either the description or the (first) pinned comment respectively. Those events have a `.detail.elt` attribute which contains the element immediately parent to the text. The `.detail.source` attribute contains a string identifying the source of the element (description or comment)
Use `.stop()` to stop looking for tracklists. It does not remove the listeners.

### TracklistDisplay

Handles the creation, and provides an interface to the display.

`getDisplay` fetches the display from DOM.
`.exists` tells you if it exists.
`createDisplay` creates a new display.
`.create` makes sure a display exists.
`.setText (newText)` sets the new displayed text.

### TracklistUpdater

Handles the selection of the tracklist, and updating the TracklistDisplay.

`.setPlayer (player)` gives **TracklistDisplay** a player.
`.reset` resets the loaded tracklist et all other internal variables.
`setTracklist (tr, src)` sets the tracklist to `tr` and the source to `src`.
`.offerTracklist (tr, src)` offers it the tracklist `tr` of (optional) source `src`. It will then decide to use it or not.
`update` is the updater function for the Interval.
`.isRunning` tells you whether it is running or not.
`.run` makes sure it is running.

### MixList

Calling `.shoot(id)` will setup the the listeners between TracklistFinder and DisplayUpdater and clean up the previous ones.

# Inner workings

The 'locationchange' CustomEvent has a detail attribute. It's key `url` contains the new url.

The 'videoidchange' CustomEvent has a detail attribute. It's key `id` contains the id, or null if invalid.
