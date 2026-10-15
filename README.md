# Spotify Overlay Tape

Press **F8** in any game and a small tape-deck overlay drops in with what's playing: the song, the album art, time left, playback controls and your playlists. Press F8 again, or move your mouse away, and it's gone.

It's made for gaming: the hotkey works inside games that block normal Windows hotkeys (League of Legends, for example), and keys you press still reach the game.

## Download

Grab **`Spotify Overlay 1.0.0.exe`** from the [latest release](../../releases/latest). It's a portable app, so there's nothing to install: put it anywhere and double-click it.

Windows may show a SmartScreen warning the first time, because the app isn't code-signed. Click **More info → Run anyway**.

## What it does

- **Now playing:** song, artist, album art and a countdown of the time left.
- **Controls:** play/pause, next, previous, shuffle and like (heart).
- **Playlists:** your playlists and Liked Songs, one click to play.
- **Music-reactive look:** a starfield globe and waveform that move with the music. The whole theme can take its colour from the album cover.
- **Corner globe (optional):** a small click-through globe in a screen corner that stays over your games.
- **Opens with Spotify (optional):** the overlay starts when Spotify opens and quits when it closes, so it uses nothing while Spotify is off.
- **Your own hotkey:** F8 by default, or any key or combo you like.

## First-time setup

The overlay works with any Spotify app that's playing on your PC. To see your playlists and album art, connect your Spotify account once. Spotify requires every app to have its own free "Client ID":

1. Open [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in with your Spotify account.
2. Click **Create app**:
   - Name: `Spotify Overlay`
   - Description: `Personal overlay`
   - Redirect URI: `http://127.0.0.1:8888/callback`, then click **Add**
   - Tick **Web API**, accept the terms and **Save**.
3. Open your new app's **Settings** and copy the **Client ID**.
4. In the overlay, open **Settings**, paste the Client ID and click **Connect**. Spotify shows one "Agree" page in your browser, and you're done.

**Privacy:** the overlay only reads your playlists and what's playing. It uses Spotify's standard PKCE sign-in, so there's no secret key involved. Your login token is stored encrypted on your own PC, and nothing is sent anywhere except to Spotify.

## Settings

Everything saves as you change it:

- **Show/hide key:** click the box, then press the key or combo you want.
- **Position:** top centre, top left or top right.
- **Auto-hide:** seconds after your mouse leaves. 0 keeps it up until you press the key.
- **Open/close sound and music reaction strength.**
- **Colour from the album art.**
- **Corner globe:** corner, size, opacity, and whether to show it only while music plays.

## Building from source

You need [Node.js](https://nodejs.org/) on Windows.

```
npm install
npm start          # run it
npm run dist       # build the portable exe into dist/
```

The two small helpers in `watcher/` are C#, and their source sits next to them. Each `.cs` file's header has its one-line build command (it uses the C# compiler that comes with Windows).

## Credits

Display font: [DSEG](https://github.com/keshikan/DSEG) by keshikan (SIL Open Font License, see `fonts/DSEG-LICENSE.txt`).

## License

MIT, see [LICENSE](LICENSE).
