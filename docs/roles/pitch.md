# Product and pitch lead

You own the story and the submission: the problem proof, the slides, the demo script, the video, the README, Devpost,
and the ethics check-in. Impact (25) and Presentation (10) are mostly yours.

## Your deliverables

1. **Problem proof** (Saturday, before 3 PM):
   - ~10 short student interviews: "What's the worst time you got lost in a BU building?" Get quotes, and permission to use them.
   - A timed test: a stranger finds a room without the app (stopwatch). Repeat with the app in the evening.
2. **Devpost project created Saturday evening** (required), with every teammate joined. Final submission **by Sun 10:00 AM**.
3. **Slides** (4-minute hard limit):
   1. Problem: GPS fails indoors; BU has no public indoor map, and its accessibility map stops at the front door.
      Interview quotes and the timing result.
   2. Live demo (~90 s).
   3. How it works: photo → DINOv2 retrieval with top-10 voting → spot + floor → route. OCR backup for look-alike floors.
   4. Results: ML's experiments table and test-set accuracy (outsider photos).
   5. Ethics: Backend's slide.
   6. Scale: "One building this weekend; ~30 min of walking video per building. BU's first accessible indoor routes."
      Partners: Disability & Access Services, Admissions, Orientation, IS&T.
4. **Demo script**: hand a judge the phone → "Take a photo of this hallway" → it names the floor → route to room 164.
   Then a tricky spot: if unsure, the judge taps the right answer, a second photo gets it right. "It just learned from you."
   Rehearse with a backup screen recording in case the Wi-Fi dies.
5. **Demo video** (setup and demo), recorded Saturday night.
6. **README**: problem, how it works, results table, ethics, setup steps, live link, team. Coordinate with each lead.
7. **Hackachusetts call at 6 PM**: only enter if matching works by then and there's a real fit (needs Kiro, deadline 8 PM).

## Prizes to aim at

- College Hack placement.
- **BU Libraries Data Ethics & Literacy ($500)**: talk to the librarians (basement yellow space) about the dataset card
  and ethics choices. Visit the Ethics Genius Bar Saturday.
- Best Use of Lovable, if the front end uses it.
- Best First-Year / First-Time Hacker, if anyone on the team qualifies.

## Prior-art lines to use

- "Google built indoor AR navigation for airports and malls (Indoor Live View, 2021). Nobody built it for students."
- "The same retrieval-first approach as the InLoc indoor localization research, adapted to one building in a weekend."
- "Apple-style privacy, built to avoid the PIGEON problem."

## If a judge asks "why not Wi-Fi positioning?"

Web apps can't scan Wi-Fi; it needs IS&T's access-point data; it's often meters off and confuses floors; and it works
by tracking devices. Hound Around needs one photo, only when you ask.

## Done means

- Devpost submitted by 10 AM Sunday, with the repo, live link, slides and video, and every teammate listed.
- The deck runs under 4:00 in rehearsal, twice.

## Don'ts

- Don't put floor plans, the graph or unblurred photos in slides, the video or Devpost.
- Don't quote a number ML hasn't measured on the outsider test set.
- Don't invent event rules. Check Devpost, Discord or hackbu@bu.edu.
