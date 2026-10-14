# splat-explorer

A browser-based viewer for Splatoon 3 data and historical X Rank standings.

## Features

- View, search, and copy JSON in a tree.
- Load JSON or `.tar.zst` archives from a URL or local file, or paste JSON directly.
- Browse JSON files inside `.tar.zst` archives.
- Decode Base64-encoded SplatNet IDs.
- Repair some forms of garbled Japanese text.
- Search X Rank players by ID or previously recorded names, view their final rankings, and inspect when each name appeared.

## Data sources

Historical X Rank records were obtained from [splatoon3.ink](https://splatoon3.ink) and processed into static JSON files. Weapon names are based on [Leanny/splat3](https://github.com/Leanny/splat3) and Nintendo's Japanese weapon names.

This is an unofficial, independent project and is not affiliated with Nintendo, splatoon3.ink, or Leanny.

## Usage

Open the GitHub Pages site in a browser. Loading data directly from other sites requires their servers to allow cross-origin requests (CORS).

## License

The project's source code is licensed under the MIT License. Third-party data and assets may have separate terms.
