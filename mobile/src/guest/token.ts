/**
 * The token in an invitation link. A host shares a link; a guest may paste the whole link or only
 * the token that ends it.
 */
export function tokenFromLink(value: string): string {
  const text = value.trim();
  const marker = "/invite/";
  const index = text.indexOf(marker);
  if (index >= 0) return text.slice(index + marker.length).split(/[/?#]/)[0] ?? "";
  return text;
}
