# news-image-20261124 v2 — The day in pictures

[![news-image-20261124](https://make.fun/badge/news-image-20261124.svg)](https://make.fun/bounty/news-image-20261124?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261124)
[![rank](https://make.fun/badge/news-image-20261124/zesty-pika-87/news-image-20261124-v2-entry/rank.svg)](https://make.fun/bounty/news-image-20261124?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261124)
[![reward](https://make.fun/badge/news-image-20261124/zesty-pika-87/news-image-20261124-v2-entry/reward.svg)](https://make.fun/bounty/news-image-20261124?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261124)

One image that sums up the world's news of **Tuesday, 24 November 2026**:
35 stories from 7 regions on a single front page.

## The idea

Pictures lead, text follows. Three tall illustrated heroes and ten square
scenes each show what happened — a chip stock chart roaring upward, a jet
crossing into Korean airspace, an empty COP31 negotiating table — with the
headline as a caption *underneath* the picture, never printed over it.

The new technique in this build is **fit-check**: every text block is
measured against its cell before it is drawn, and the font shrinks step by
step until the block fits. Nothing overflows, nothing gets clipped, and the
program prints a fit report proving zero overflows.

## What is inside

- `main.ts` — the whole entry. Node 22, standard library only, no network.
  It draws everything itself: a hand-drawn proportional bitmap font
  (rendered with 3x supersampling so edges stay smooth at 300px), its own
  PNG encoder, 13 hand-drawn scenes, the numbered world map, and the
  35-story index. Deterministic: two runs write byte-identical PNGs.
- The numbers band carries six numbers from six different stories
  (NVIDIA +31%, TAIEX +9%, GOLD $3,645, JAPAN PMI 53.7, BRENT $89.72,
  24 KILLED) — no figure is repeated anywhere else on the page.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

It writes `out/entry.png` (1024x1024, under 1 MiB) and prints a
`FIT-REPORT` line: 35 stories, 13 scenes, 7 regions, zero overflows.

## License

MIT — see [LICENSE](LICENSE).

---

Built for the [news-image-20261124 bounty](https://make.fun/bounty/news-image-20261124?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261124) on make.fun. New to make.fun? Join with my referral link: https://make.fun/?ref=1aaz13gb
