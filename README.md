# Catrow

Mobile-first vertical puzzle prototype (9:16) inspired by Arrow Escape, with cats.

## Run

Open `index.html` directly in a browser, or serve this folder with a static server.

## Current Rules

- Grid is `10 x 15`.
- Each cat occupies `1 x 2` cells and has one direction.
- Tap a cat to move it along its direction until blocked or escaped.
- Escaped cats run on the road to their matching color house.
- Houses are at the top and show how many cats of each color remain.

## Puzzle Generation Constraints

- Starts with a random cat and keeps adding random cats.
- No overlapping cats.
- No directed closed loops between cat line-of-sight links.
- No opposite-facing cats on the same row/column with clear line-of-sight.
