---
inclusion: always
---

# Hound rules: the non-negotiable checklist

These rules come from `CLAUDE.md`, `docs/roles/README.md`, and
`docs/contract.md`. They are non-negotiable. Apply this checklist to **every**
change before committing. If any box cannot be checked, stop and surface it as
an open question instead of guessing.

## Contract and API

- [ ] `docs/contract.md` is law. I did **not** rename any field, change a type,
      change nullability, or add/remove an endpoint or field.
- [ ] If a contract change seemed necessary, I left it as an **open question in
      the requirements** and got explicit team approval before touching it.
- [ ] I never edited `docs/contract.md` to match my code; code conforms to the
      contract, not the other way around.

## Node ids and floors

- [ ] Node ids (e.g. `F2_hall_e2`, `B1_core_elev`) come only from
      `data/graph.json`. I did **not** invent any node id.
- [ ] Floors are limited to **B1 (-1), F1, F2**. No floor 3+ anywhere.

## Privacy and data

- [ ] I did **not** commit anything under `data/` (frames, videos, floor plans,
      `graph.json`, `rooms.json`, `labels.csv`, `anchors.json`, `nodes.txt`).
- [ ] I did **not** commit images/videos (`*.jpg`, `*.jpeg`, `*.heic`, `*.mov`,
      `*.mp4`, or `*.png` outside `docs/img/`), `*.npz`, `*.sqlite`, model
      weights, `.env`, or any secret/token.
- [ ] Faces are blurred before any frame leaves the laptop (pipeline
      responsibility).
- [ ] No GPS, Wi-Fi/network location, or tracking anywhere. The photo is the
      only input.
- [ ] The API discards each photo after embedding; no user photo is stored or
      retained (in RAM only, vectors cached, image closed immediately).

## gitignore and .kiro

- [ ] I did **not** loosen `.gitignore` and did **not** modify it at all.
- [ ] I did **not** add `.kiro/` to `.gitignore`. `.kiro/` must stay in the repo
      (Hackachusetts requires the `/.kiro` folder). Verify:
      `git check-ignore .kiro/` prints nothing (exit non-zero).

## Dependencies

- [ ] No new dependency added without team approval. Any proposed package is
      listed in the design with where it is used and roughly how big it is.

## Proof and process

- [ ] The change ends with a command that proves it works: `python -m pytest -q`,
      a `curl`, `npm run build`, or a script that prints results.
- [ ] Tests use synthetic data only (generated images, made-up graphs), never
      building photos.
- [ ] Work happens on a branch and lands via a pull request; never push to main.
- [ ] Changes are surgical: no refactor of working `api/`, `pipeline/`, or
      `frontend/` code unless the task requires it.
