# Third-Party Notices

## Runtime

- Phaser 3.90.0, MIT License, https://phaser.io/
- PeerJS 1.5.5, MIT License, https://peerjs.com/

Both browser distributions and their license texts are vendored under `submission/vendor/` and `submission/assets/licenses/` so the game entry does not depend on a runtime script CDN.

## Fonts

- Barlow Condensed, SIL Open Font License 1.1, Fontsource distribution; license at `submission/assets/licenses/barlow-OFL.txt`.
- JetBrains Mono, SIL Open Font License 1.1, Fontsource distribution; license at `submission/assets/licenses/jetbrains-mono-OFL.txt`.
- Noto Sans SC, SIL Open Font License 1.1, Google Fonts; a UI-character subset is vendored locally with its license at `submission/assets/fonts/OFL-Noto.txt`.

## Reference-only material

The following Steam store screenshots are retained only as local design references and are not part of the deployed site:

- Nuclear Throne screenshot, source: `https://store.steampowered.com/app/242680/`
- Hotline Miami screenshot, source: `https://store.steampowered.com/app/219150/`

## Network services

- PeerJS public PeerServer is used only for WebRTC signaling.
- Netlify is used for static hosting if deployment authentication is completed.
