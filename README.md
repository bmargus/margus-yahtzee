# Margus Yahtzee

An elegant, three-player, real-time Yahtzee game for Brad, Jarrett and Quinn.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open http://localhost:3000 in three separate browsers/devices and choose a different player in each.

## Deploy to Render

1. Create a GitHub repository called `margus-yahtzee`.
2. Upload `server.js`, `package.json`, `render.yaml`, and the `public/index.html` file, keeping `index.html` inside the `public` folder.
3. On Render, choose **New > Web Service**, connect your repository, and deploy using Node, `npm install` as build command, and `npm start` as start command. Or choose **New > Blueprint** and use `render.yaml`.
4. Share the Render URL with Brad, Jarrett and Quinn. Each should choose their own name.

## Important notes

- The server is authoritative for dice rolls, scoring and turn order.
- This is a private-by-convention family game, **not password protected**. Anyone with the URL could attempt to join a vacant seat. Add authentication if the URL will be shared publicly.
- Scores and the last 15 game results are stored in `game-data.json` on the server. Render's free ephemeral filesystem can reset on redeployment or restart, so long-term Hall of Fame persistence is **not guaranteed** without a persistent disk or database.
- A disconnected player can reconnect by reloading. An active player name cannot be taken over by a second browser while connected.
- The full scorecard is designed to fit beside the dice on ordinary desktop and laptop screens. Very short windows or zoomed-in browser settings may still require scrolling.
- Standard Yahtzee Joker rules are supported for additional Yahtzees after a 50-point Yahtzee.
