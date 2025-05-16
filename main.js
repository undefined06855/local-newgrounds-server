import * as fs from "fs/promises"
import * as schedule from "node-schedule"
import * as rob from "./robtop"
import "log-timestamp"

const config = {
    port: 3000,
    ip: "0.0.0.0",
    refreshInterval: "0 */2 * * *", // every 2 hours
    useNGProxy: false,

    sfxFolder: "storage/sfx",
    songsFolder: "storage/songs",

    ...await fs.exists("config.json") && JSON.parse(await fs.readFile("config.json")),
    ...process.env
}

// prevent process closing on uncaught exception / unhandled async rejection
process.on("uncaughtException", event => {
    console.warn(`Uncaught Exception: ${event.message}\n${event.stack}\n${event.cause}`)
})
process.on("unhandledRejection", event => {
    console.warn(`Unhandled Rejection: ${event.message}\n${event.stack}\n${event.cause}`)
})

// create folders for shit
!await fs.exists(config.sfxFolder) && await fs.mkdir(config.sfxFolder, { recursive: true })
!await fs.exists(config.songsFolder) && await fs.mkdir(config.songsFolder, { recursive: true })

// and start bun api server
Bun.serve({
    routes: {
        "/": Response.json({
            version: "v1.0.0",
            refreshInterval: config.refreshInterval
        }),

        "/poll/:type/:id": async req => {
            console.log("polling %s %s", req.params.type, req.params.id)
            if (isNaN(parseInt(req.params.id))) {
                return Response.json({ invalid: true })
            }

            if (![ "sfx", "song" ].includes(req.params.type)) {
                return Response.json({ invalid: true })
            }

            let path = req.params.type == "sfx" ? config.sfxFolder : config.songsFolder

            let exists = await fs.exists(`${path}/${req.params.id}`)
            return Response.json({ invalid: false, exists })
        },

        "/download/:type/:id": async req => {
            console.log("downloading %s %s", req.params.type, req.params.id)
            if (isNaN(parseInt(req.params.id))) {
                return Response.json({ invalid: true })
            }

            if (![ "sfx", "song" ].includes(req.params.type)) {
                return Response.json({ invalid: true })
            }

            let path = req.params.type == "sfx" ? config.sfxFolder : config.songsFolder

            let exists = await fs.exists(`${path}/${req.params.id}`)
            if (!exists) {
                return Response.json({ invalid: true })
            }

            return new Response(
                await Bun.file(`${path}/${req.params.id}`).bytes(),
                { headers: { "Content-Type": req.params.type == "songs" ? "audio/mpeg" : "audio/ogg" } }
            )
        },

        "/refresh": async req => {
            console.log("refreshing...")
            await clearAndDownloadAll()
            return Response.json({ success: true })
        },

        // who needs a 404 page in 2025
        // this also redirects the favicon to 404 so
        "/*": Response.redirect("https://http.cat/404")
    },

    hostname: config.ip,
    port: config.port
})

/**
 * @typedef {RobtopAudio & { isSFX: true }} RobtopSFX
 * @typedef {RobtopAudio & { isSFX: false }} RobtopSong
 */

// RobTop song/sfx wrapper class
class RobtopAudio {
    /**
     * @param {number} id 
     * @param {boolean} isSFX 
     */
    constructor(id, isSFX) {
        /** @type {number} */
        this.id = id
        /** @type {boolean} */
        this.isSFX = isSFX

        /** @type {boolean} */
        this.invalid = false
        /** @type {string} */
        this.downloadEndpoint = ""
    }

    async getSongInfo() {
        console.debug("Getting song info for %s %s", this.isSFX ? "sfx" : "song", this.id)
        if (this.isSFX) {
            this.downloadEndpoint = `https://geometrydashfiles.b-cdn.net/sfx/s${this.id}.ogg`
            return this
        }

        let info = await rob.getGJSongInfo(this.id)

        if (!info.availableForUse) {
            console.warn("Song not available for use!")
            this.invalid = true
            return this
        }

        this.downloadEndpoint = info[10] == "CUSTOMURL" ? `https://geometrydashfiles.b-cdn.net/music/${this.id}.ogg` : decodeURIComponent(info[10])

        if (config.useNGProxy) {
            this.downloadEndpoint.replace("audio.ngfiles.com", "ngproxy.dankmeme.dev")
        }

        return this
    }
}

// RobTop level wrapper class to download audio assets
class RobTopLevel {
    /**
     * @param {number} id 
     */
    constructor(id) {
        /** @type {number} */
        this.id = id
        /** @type {Array<RobtopSFX>} */
        this.sfxs = []
        /** @type {Array<RobtopSong>} */
        this.songs = []
    }

    async downloadLevel() {
        console.log("Downloading data for level %s", this.id)

        let level = await rob.downloadGJLevel22(this.id)

        // 35 is the top-most song and the only song for 2.1 levels
        // 52 is song list 2.2 and 53 is sfx list
        let songIDs = level[52] ? level[52].split(",") : [ level[35] ]
        let sfxIDs = level[53] ? level[53].split(",") : [ ]

        this.songs = await Promise.all(songIDs.map(async id => await new RobtopAudio(id, false).getSongInfo()))
        this.sfxs = await Promise.all(sfxIDs.map(async id => await new RobtopAudio(id, true).getSongInfo()))

        return this
    }

    async downloadAssets() {
        let fileWritePromises = []

        for (let [prefix, list] of [
            [ config.songsFolder, this.songs ],
            [ config.sfxFolder, this.sfxs ]
        ]) {
            for (let song of list) {
                if (song.invalid) continue
                const path = `${prefix}/${song.id}`
                if (await fs.exists(path)) continue

                console.log("Downloading song %s", song.id)
                let res = await fetch(song.downloadEndpoint)
                if (!res.ok) {
                    console.warn("Response was not ok! Skipping...")
                    console.warn(await res.text())
                    continue
                }

                fileWritePromises.push(fs.writeFile(path, await res.arrayBuffer()))
            }
        }

        await Promise.all(fileWritePromises)
        return this
    }
}

// Other RobTop handler
class RobTopHandler {
    /**
     * Clears everything in sfx and songs folders
     */
    static async clearAll() {
        let dirs = [ config.sfxFolder, config.songsFolder ]
        for (let folder of dirs) {
            for (let file of await fs.readdir(folder)) {
                await fs.unlink(`${folder}/${file}`)
            }
        }
    }

    /**
     * Downloads literally everything
     */
    static async downloadAll() {
        await this.downloadSpecialLevels()
        await this.downloadFeaturedPages(2)
    }

    /**
     * Downloads a certain amount of featured pages and their assets
     * @param {number} count 
     */
    static async downloadFeaturedPages(count) {
        console.log("Downloading %s featured pages...", count)
        for (let i = 0; i < count; i++) {
            for await (let levelID of this.getFeaturedPageIDs(i)) {
                let level = new RobTopLevel(levelID)
                await level.downloadLevel()
                await level.downloadAssets()
            }
        }
        console.log("Downloaded featured pages!")
    }

    /**
     * Downloads daily, weekly and event levels' assets
     */
    static async downloadSpecialLevels() {
        console.log("Downloading special levels...")
        for (let i = -1; i >= -3; i--) {
            let level = new RobTopLevel(i)
            await level.downloadLevel()
            await level.downloadAssets()
        }
        console.log("Downloaded special levels!")
    }

    /**
     * Gets IDs on a certain page of the featured tab
     * @param {number} page 
     * @returns {AsyncGenerator<number, void, unknown>}
     */
    static async* getFeaturedPageIDs(page) {
        let levels = await rob.getGJLevels21(6, page)

        for (let level of levels) {
            let id = level[1]
            yield parseInt(id)
        }
    }
}

async function clearAndDownloadAll() {
    console.debug("Downloading songs...")
    console.time("downloading")
    await RobTopHandler.clearAll()
    await RobTopHandler.downloadAll()
    console.timeEnd("downloading")
}

schedule.scheduleJob(config.refreshInterval, clearAndDownloadAll)
console.log("Server started at %s:%s, set to update %s", config.ip, config.port, config.refreshInterval)
await clearAndDownloadAll()
