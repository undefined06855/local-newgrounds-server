# Local Newgrounds Download Server

## Requirements
- Bun v1.2.3 or higher
- The ability to run this on a server on the same network as your personal GD computer (or on your GD computer on startup)

## Setup
1. `git clone https://github.com/undefined06855/local-newgrounds-server` to clone the repository to the server
1. `cd local-newgrounds-server`
1. `bun i` to install dependencies
1. Create a `config.json` with `ip`, `port` and a cron string `refreshInterval` (or don't, there's defaults)
1. `bun main` to start the server

## Rate Limits
There is a chance this will get your IP rate limited! This is shown by a `RobtopServerError 1015`, which usually lasts for an hour. This is only an issue if you set `refreshInterval` to be very frequent, or you frequently restart the server.
