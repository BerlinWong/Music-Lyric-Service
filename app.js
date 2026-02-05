const express = require('express')
const request = require('./util/request')
const cloudsearch = require('./module/cloudsearch')
const lyric = require('./module/lyric')
const axios = require('axios')
const OpenCC = require('opencc-js')

const app = express()
const PORT = process.env.PORT || 3000

// Initialize converter (Traditional to Simplified)
const converter = OpenCC.Converter({ from: 'hk', to: 'cn' })

function isJunkLyric(lrc) {
    if (!lrc) return true
    
    const lines = lrc.split('\n').map(l => l.trim()).filter(l => l)
    // If very few lines, likely junk or instrumental marked wrong
    // But some songs are short.
    
    // Check for "Metadata only" lyrics
    // keywords: 作词, 作曲, 编曲, 制作人, Author, Composer, Arranger, Producer
    const metadataKeywords = ['作词', '作曲', '编曲', '制作人', 'Author', 'Composer', 'Arranger', 'Producer', '录音', '混音']
    
    // Regex to match lines that *START* with time tag and then immediately metadata
    // e.g. [00:00.00] 作词 : ...
    // or just plain lines starting with metadata
    
    let contentLineCount = 0
    for (const line of lines) {
        // Remove time tags
        const content = line.replace(/\[.*?\]/g, '').trim()
        if (!content) continue

        // Check if this line is metadata
        const isMetadata = metadataKeywords.some(kw => content.startsWith(kw) || content.includes(`: ${kw}`))
        if (!isMetadata) {
            contentLineCount++
        }
    }

    // If we have very few actual content lines (e.g. < 2), treat as junk
    if (contentLineCount < 2) {
        return true
    }

    return false
}

// Helper: Retry wrapper
async function withRetry(fn, retries = 1, delay = 1000) {
    let lastError
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn()
        } catch (e) {
            lastError = e
            console.log(`[Retry] Attempt ${i + 1} failed. ${retries - i} retries left. Error: ${e.message}`)
            if (i < retries) await new Promise(res => setTimeout(res, delay))
        }
    }
    throw lastError
}

// Helper: Search and Get Netease Lyrics
async function getNeteaseLyrics(artist_name, track_name, album_name, duration) {
    const keyword = `${track_name} ${artist_name || ''}`.trim()
    console.log(`[NCM] Searching for: ${keyword}`)

    const baseQuery = { cookie: {}, proxy: '', realIP: '' }
    
    try {
        const searchRes = await withRetry(() => cloudsearch({
            ...baseQuery,
            keywords: keyword,
            limit: 10,
            type: 1
        }, request), 1)

        if (!searchRes.body?.result?.songs?.length) {
            console.log('[NCM] No search results')
            return null
        }

        const songs = searchRes.body.result.songs
        const targetDuration = duration ? parseInt(duration) * 1000 : null
        let bestMatch = null
        let bestScore = -1

        for (const song of songs) {
            let score = 0
            if (song.name.toLowerCase() === track_name.toLowerCase()) score += 10
            
            if (artist_name) {
                const artists = song.ar || song.artists || []
                const artistNames = artists.map(a => a.name.toLowerCase())
                if (artistNames.some(name => name.includes(artist_name.toLowerCase()) || artist_name.toLowerCase().includes(name))) {
                    score += 5
                }
            }

            if (album_name && song.al?.name && song.al.name.toLowerCase() === album_name.toLowerCase()) {
                score += 3
            }

            if (targetDuration && song.dt) {
                const diff = Math.abs(song.dt - targetDuration)
                if (diff < 5000) score += 10
                else if (diff > 30000) score -= 20
            }

            if (score > bestScore) {
                bestScore = score
                bestMatch = song
            }
        }

        if (!bestMatch || bestScore < 0) bestMatch = songs[0] // Fallback to first

        console.log(`[NCM] Matched: ${bestMatch.name} (ID: ${bestMatch.id})`)

        const lyricRes = await withRetry(() => lyric({ ...baseQuery, id: bestMatch.id }, request), 1)
        const lyricBody = lyricRes.body
        const lrc = lyricBody.lrc?.lyric || ''

        if (isJunkLyric(lrc)) {
            console.log('[NCM] Lyric detected as junk/metadata only. Skipping.')
            return null
        }

        return {
            id: bestMatch.id,
            name: bestMatch.name,
            trackName: bestMatch.name,
            artistName: bestMatch.ar ? bestMatch.ar.map(a => a.name).join(', ') : '',
            albumName: bestMatch.al ? bestMatch.al.name : '',
            duration: Math.round(bestMatch.dt / 1000),
            instrumental: false,
            plainLyrics: lrc.replace(/\[.*?\]/g, ''),
            syncedLyrics: lrc
        }
    } catch (error) {
        console.log(`[NCM] Error during fetch: ${error.message}`)
        return null
    }
}

// Helper: Get Lrclib Lyrics
async function getLrclibLyrics(artist_name, track_name, album_name, duration) {
    console.log('[Lrclib] Fetching...')
    try {
        const params = new URLSearchParams({
            artist_name: artist_name || '',
            track_name: track_name || '',
            album_name: album_name || '',
            duration: duration || ''
        })
        
        return await withRetry(async () => {
            const res = await axios.get(`https://lrclib.net/api/get?${params.toString()}`, { timeout: 8000 })
            const data = res.data

            if (!data || !data.syncedLyrics) {
                 console.log('[Lrclib] No lyrics found')
                 return null
            }
            
            console.log(`[Lrclib] Found: ${data.trackName}`)

            // Convert lyrics to Simplified Chinese
            const plainLyrics = converter(data.plainLyrics || '')
            const syncedLyrics = converter(data.syncedLyrics || '')

            return {
                id: data.id,
                name: data.trackName,
                trackName: data.trackName,
                artistName: data.artistName,
                albumName: data.albumName,
                duration: Math.round(data.duration),
                instrumental: data.instrumental,
                plainLyrics: plainLyrics,
                syncedLyrics: syncedLyrics
            }
        }, 1) // Retry once

    } catch (e) {
        console.log(`[Lrclib] Error: ${e.message}`)
        return null
    }
}

app.get('/api/get', async (req, res) => {
    try {
        const { artist_name, track_name, album_name, duration } = req.query

        if (!track_name) {
            return res.status(400).json({ error: 'track_name is required' })
        }

        // 1. Try Netease
        let result = await getNeteaseLyrics(artist_name, track_name, album_name, duration)
        
        // 2. Try Lrclib if Netease failed
        if (!result) {
            console.log('[Fallback] NCM failed or rejected, trying Lrclib')
            result = await getLrclibLyrics(artist_name, track_name, album_name, duration)
        }

        // 3. Fallback if both failed
        if (!result) {
            console.log('[Fallback] Both sources failed')
            return res.json({
                id: 0,
                name: track_name,
                trackName: track_name,
                artistName: artist_name || '',
                albumName: album_name || '',
                duration: duration ? parseInt(duration) : 0,
                instrumental: false,
                plainLyrics: 'Lyrics not found on Netease or Lrclib',
                syncedLyrics: '[00:00.00] Lyrics not found on Netease or Lrclib'
            })
        }

        res.json(result)

    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal Server Error' })
    }
})

app.listen(PORT, () => {
    console.log(`Lyric Service running on port ${PORT}`)
})
