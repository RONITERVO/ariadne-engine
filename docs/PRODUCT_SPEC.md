# Product spec: Ariadne Engine

## One-sentence product

A no-UI voice roleplay engine where every story is a branchable, replayable, audio-preserved timeline.

## User experience

The default experience has a short setup gate: sign in for prepaid credits or paste a Gemini API key. After that, the browser shows only the realtime transcript.

1. User signs in or pastes a key.
2. Ariadne opens or creates a branch.
3. User speaks a line or action.
4. Browser speech recognition detects speech start; it is not the transcript authority.
5. The browser sends two seconds of pre-roll audio, speech audio, and two seconds of trailing audio to Gemini Live.
6. Gemini Live returns user transcript, model transcript, and model audio.
7. Ariadne commits the Live transcripts, canonizes the turn, and resumes listening.

## Voice commands

Commands are interpreted as story-control acts, not UI clicks.

- "Continue."
- "Fork here."
- "Take me back to the inn before the spy arrived."
- "Show me my branches."
- "Read the branch where I saved the city."
- "Start a new branch from the betrayal."
- "Close this story in the next few scenes."

## Modes

### Story mode

The model stays in character and responds as narrator / NPCs / scene director.

### Library mode

The app can generate a concise voice menu of story repositories and branches. The user selects by speaking.

### Time-machine mode

The app finds a past event semantically, confirms it aloud, then forks from that turn.

### Closure mode

The app stops opening new arcs and resolves active threads before the context budget is exhausted.

## Differentiators

### Branches are first-class

Each branch is a pointer to a turn commit. Forking does not copy the full transcript. It creates a new branch ref pointing at an existing turn.

### Audio is first-class

Every production turn should store:

- raw user audio
- normalized user audio
- user transcript
- raw assistant audio
- assistant transcript
- alignment between transcript spans and audio timestamps when available

The current release stores transcripts and has schema support for audio metadata; object-storage audio upload remains a beta item.

### AI is not trusted as memory

The AI proposes a patch. The deterministic state compiler applies only valid state changes.

### Latency and continuity are decoupled

Gemini Live answers quickly. Canonization, auditing, embeddings, and snapshots happen after the turn.
