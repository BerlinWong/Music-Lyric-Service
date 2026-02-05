# Simple Music Lyric Service

A lightweight lyric service based on [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) and [Lrclib](https://lrclib.net/).

It focuses solely on retrieving synchronized lyrics by intelligently chaining search requests: first trying Netease Cloud Music, then falling back to Lrclib.

## Features

- **Double Source**:
  1.  **Netease Cloud Music**: Primary source. Automatically partial-matches songs.
  2.  **Lrclib**: Fallback source. Used if Netease fails or returns low-quality lyrics.
- **Smart Logic**:
  - **Junk Detection**: Automatically rejects lyrics that only contain metadata (e.g., "Composer: ...") without actual lines.
  - **T2S Conversion**: Automatically converts Traditional Chinese lyrics from Lrclib to Simplified Chinese.
  - **Strict Search**: Matches based on Track Name, Artist, Album, and Duration.
- **Unified Output**: Returns a strict, clean JSON format.

## Installation

```bash
git clone git clone https://gitclone.com/github.com/BerlinWong/Music-Lyric-Service.git
cd Music-Lyric-Service
npm install
```

## Usage

Start the server:

```bash
node app.js
```

The server runs on port **3000** by default.

## API Endpoint

### `GET /api/get`

Retrieves lyric information.

**Parameters:**

| Parameter     | Type   | Required | Description                                         |
| :------------ | :----- | :------- | :-------------------------------------------------- |
| `track_name`  | string | **Yes**  | The title of the song                               |
| `artist_name` | string | No       | The artist name (recommended for accuracy)          |
| `album_name`  | string | No       | The album name                                      |
| `duration`    | number | No       | Song duration in seconds (recommended for matching) |

**Response (Success):**

```json
{
  "id": 2078672512,
  "name": "I Want to Live",
  "trackName": "I Want to Live",
  "artistName": "Borislav Slavov",
  "albumName": "Baldur's Gate 3 (Original Game Soundtrack)",
  "duration": 233,
  "instrumental": false,
  "plainLyrics": "...",
  "syncedLyrics": "[00:00.00-1] 作词 : Sarah Baylus\n..."
}
```

**Response (Not Found):**

```json
{
  "id": 0,
  "name": "Song Name",
  "trackName": "Song Name",
  "artistName": "Artist",
  "albumName": "",
  "duration": 0,
  "instrumental": false,
  "plainLyrics": "Lyrics not found on Netease or Lrclib",
  "syncedLyrics": "[00:00.00] Lyrics not found on Netease or Lrclib"
}
```

## License

The MIT License (MIT)
