/** @jsxImportSource hono/jsx */
import type { HNStory } from "./data.ts";

export default function HackerNews({ stories }: { stories: HNStory[] }) {
  return (
    <section class="section">
      <h2 class="section__header">Hacker News — Top</h2>
      {stories.map((s) => <div class="hn-item">{s.title}</div>)}
    </section>
  );
}
