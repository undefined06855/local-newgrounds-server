// wrapper around RobTop specific things for node/bun/web with JSDoc comments,
// feel free to take if you need
// - undefined0 14/05/2025

/**
 * @typedef {Array<string>} RobtopObject
 */

export class RobtopServerError extends Error {
    constructor(message) {
        super(message)
        this.name = "RobtopServerError"
    }

    /**
     * Creates a RobtopServerError from a boomlings.com endpoint response
     * @param {string} response
     */
    static fromRobtopResponse(response) {
        if (response.startsWith("error code: ")) {
            return new RobtopServerError(response.substring(12))
        }

        return new RobtopServerError(response)
    }
}

/**
 * Parses a RobTop formatted data object, with custom delimiter
 * @param {string} string The source string returned from the server
 * @param {string} delimiter The delimiter between keys and values, usually : but can be ~|~ or comma
 * @returns {Array<string>} The resulting sparse array
 */
export function parseRobTopObject(string, delimiter) {
    if (string == "-1") {
        console.warn("Trying to parse RobTop formatted data when server returned -1!")
        return []
    }

    let res = []
    let split = string.split(delimiter)

    if (split.length % 2 != 0) {
        console.warn("Trying to parse RobTop formatted data with length that isn't divisble by two!")
    }

    for (let i = 0; i < split.length; i += 2) {
        res[parseInt(split[i])] = split[i + 1]
    }

    return res
}

/**
 * Fetches levels using getGJLevels21
 * @param {number} type The type, see https://wyliemaster.github.io/gddocs/#/endpoints/levels/getGJLevels21?id=type
 * @param {number} page The page to fetch
 * @returns {Promise<Array<RobtopObject>>} The array of levels
 */
export async function getGJLevels21(type, page) {
    let params = new URLSearchParams()
    params.append("secret", "Wmfd2893gb7")
    params.append("type", type)
    params.append("page", page)

    let res = await fetch("https://www.boomlings.com/database/getGJLevels21.php", {
        headers: { "User-Agent": "" },
        method: "POST",
        body: params
    })

    let text = await res.text()
    if (text.startsWith("error code: ")) {
        throw RobtopServerError.fromRobtopResponse(text)
    }

    let levelsString = text.split("#")[0]
    let levels = levelsString.split("|").map(level => parseRobTopObject(level, ":"))
    return levels
}

/**
 * Fetches a single level using downloadGJLevel22
 * @param {number} id The ID of the level
 * @returns {Promise<RobtopObject>} The level
 */
export async function downloadGJLevel22(id) {
    let params = new URLSearchParams()
    params.append("secret", "Wmfd2893gb7")
    params.append("levelID", id)

    let res = await fetch("https://www.boomlings.com/database/downloadGJLevel22.php", {
        headers: { "User-Agent": "" },
        method: "POST",
        body: params
    })

    let text = await res.text()
    if (text.startsWith("error code: ")) {
        throw RobtopServerError.fromRobtopResponse(text)
    }

    let levelData = text.split("#")[0]
    return parseRobTopObject(levelData, ":")
}

/**
 * Fetches a single song's info using getGJSongInfo
 * @param {number} id The ID of the song
 * @returns {Promise<RobtopObject & { availableForUse: bool }>} The song
 */
export async function getGJSongInfo(id) {
    let params = new URLSearchParams()
    params.append("secret", "Wmfd2893gb7")
    params.append("songID", id)

    let res = await fetch("https://www.boomlings.com/database/getGJSongInfo.php", {
        headers: { "User-Agent": "" },
        method: "POST",
        body: params
    })

    let text = await res.text()
    if (text.startsWith("error code: ")) {
        throw RobtopServerError.fromRobtopResponse(text)
    }

    // song not available for use
    if (text == -2) {
        return { availableForUse: false }
    }

    let ret = parseRobTopObject(text, "~|~")
    ret.availableForUse = true
    return ret
}
