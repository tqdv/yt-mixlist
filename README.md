# yt-mixlist

A userscript to add a (not pretty) display of the currently playing song for
YouTube music mixes.

## Tech Stack

- **npm** for project management

## Notes

Racing The mutation observer and the timeout to see which one will get the player and the new id faster

Find a way to tell the function to stop if it finds other comments but not the pinned one.

## Roadmap

- Test it on more types of tracklists
- Handle document.location change
- tryRepeatedly could follow a function for frequency. Maybe use the derivative of the timing function for timeout value
  - that's because comments are loaded dynamically, I don't know how frequently to check them
  - An option to stop the tryRepeatedly would be nice too. maybe encapsulate it in a object (which would act a scope) so you can send messages to it
- Add Animations for track changing, and maybe anticipate it
- Add a progress bar for it
- Change when the display appears (because you can currently see a weird pink rectangle)
- handle multiple pinned comment, or tracklist in comment
  - Handle timestamp ranges
  - Handle oneline tracklists

## Documentation

See `documentation.md`
