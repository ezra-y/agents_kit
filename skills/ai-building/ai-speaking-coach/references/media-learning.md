# Media Learning

Use media to add natural dialogue, not to create an unsearchable transcript dump.

## Ingestion

- Prefer official or reliable subtitles when available.
- Use speech transcription only when subtitles are absent or clearly wrong.
- Preserve show, season, episode, speaker, and start/end timestamps.
- Keep two to six turns as dialogue context.
- Track each target line as its own stable content item.
- Review subtitle errors, names, slang, profanity, and scene-dependent meaning before approval.

## Teaching

Use a short scene:

1. Establish who is speaking and what they want.
2. Let the learner listen for meaning and key words.
3. Teach the target line's natural pronunciation and pragmatic force.
4. Shadow or repeat a short chunk.
5. Change the person, place, or goal and require a new use.

Do not treat watching a clip as a completed review. Only an actual listening or speaking attempt
updates learning state.

Media items use the same SQLite history, review scheduler, retrieval system, and lesson workflow as
the initial 722 course items.
