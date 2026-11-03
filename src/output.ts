export function truncateUtf8(text: string, maxBytes: number) {
  let output = "";
  let bytes = 0;
  let units = 0;
  for (const character of text) {
    const size = new TextEncoder().encode(character).length;
    if (bytes + size > maxBytes) break;
    output += character;
    bytes += size;
    units += character.length;
  }
  return { text: output, bytes, truncated: units < text.length };
}
