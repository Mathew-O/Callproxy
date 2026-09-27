/** What "Introduce me" says: who's calling, and why there may be pauses. */
export function introductionFor(user: string): string {
  return `Hi, this is ${user}. I'm typing, and a voice is reading my words out loud, so there may be short pauses. Thanks for your patience!`;
}
