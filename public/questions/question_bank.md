# Fortune Coffee — Question Bank

## Purpose
This file is the human-readable library of all farmer
interview questions and the design principles used to
generate them. It is the source of truth for question
content and curation.

Active question rotation lives in:
  webcap_repo/questions/questions.json  (app reads this)

TTS audio scripts for questions live in:
  webcap_repo/scripts/tts_scripts.json  (generator reads this)

To add a new question to the rotation:
1. Add it to this file under Active Questions
2. Add the text to tts_scripts.json under "questions"
3. Add it to questions.json for the app
4. Run generate_tts_audio.py to produce the audio files

---

## Design Principles

Use these principles when generating new questions.
All questions must satisfy principles 1–6.
Principles 7–10 apply where suitable.

1. DIGNITY FIRST
   The question must respect the farmer's intelligence,
   experience, and culture. Never patronizing, never
   extractive. The farmer should feel that someone
   genuinely cares about their perspective.

2. THOUGHT-PROVOKING OVER FACTUAL
   The question should require the farmer to imagine,
   remember, choose, or feel — not just report an
   observable fact. Avoid questions where an observer
   standing nearby could answer on the farmer's behalf.

3. TRANSLATABLE AND CONCRETE
   The question must land cleanly in Amharic, Tamil,
   Swahili, Vietnamese, Hindi, Spanish, French,
   Portuguese, and Sinhala. Favor sensory, physical,
   and relational prompts over idioms, abstractions,
   or culturally loaded concepts.

4. OPEN-ENDED WITH AN ANCHOR
   Give enough structure that the farmer does not freeze,
   but enough freedom that answers can go anywhere. The
   anchor can be a time, a place, a person, or a choice.

5. WARMTH OVER PERFORMANCE
   The question should put the farmer at ease, not on
   the spot. If it feels like a job interview or a test,
   discard it.

6. ENGAGING TO THE VIEWER
   The answer should be something a coffee consumer finds
   genuinely interesting — a window into a life they have
   never seen. Favor questions that reveal daily life,
   personality, community, or the human side of farming.

7. COFFEE-ADJACENT, NOT COFFEE-ABOUT
   Link to the farmer's world — growing things, seasons,
   land, community, food, mornings — without making every
   question explicitly about coffee. The coffee connection
   is implicit through context.

8. SERIES-FRIENDLY
   Each question must be different enough from every
   previous one that a farmer answering monthly never
   feels repetitive. Rotate across dimensions: food,
   place, people, senses, imagination, humor, heritage.

9. SENSORY WHERE SUITABLE
   Where a question can be grounded in a sense — sound,
   smell, taste, touch — do it. Sensory framing shifts
   the question from a factual report to an imaginative
   act and tends to produce more vivid, memorable answers.
   Example: "If you close your eyes on your farm right
   now, what do you hear?" rather than "What sounds do
   you hear on your farm?"

10. CURVEBALL-READY
    Every few months, include one unexpected or playful
    question that invites imagination or humor — not
    silly, but surprising enough to produce memorable,
    shareable answers. Hypotheticals and sensory-metaphor
    questions work well here.

---

## Active Questions

### Q1
What is your favorite meal to share with guests, and why?

### Q2
Besides coffee, what is your favorite thing to drink? Tell us why.

### Q3
If a visitor came to your village, where is the first place you would take them? Tell us why.

### Q4
What sounds do you hear on the farm? Please choose one sound and tell us why you remember it.

### Q5
Who taught you to grow coffee, and what is the one thing they told you that you still remember?

### Q6
Tell us something about growing coffee that would
surprise most people.

### Q7 — Curveball
If your coffee could talk, what would it say about you? Tell us why it would say that.

### Q8
What is the best part of your day? Tell us why.

### Q9
If you could invite anyone in the world to visit your farm, who would you invite? Tell us why.

### Q10
What is something you are proud of that has nothing
to do with coffee?

---

## Curveball Alternates (rotate in every few months)

- If coffee were an animal, what would it be?
- If your farm had a song, what would it sound like?
- What would you name your coffee if you could give
  it any name?

---

## Retired Questions
(move questions here when retired from active rotation,
with the date retired and reason)

---
