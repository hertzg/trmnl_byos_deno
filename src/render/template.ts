export async function loadTemplate(
  path: string | URL,
  vars: Record<string, string>,
): Promise<string> {
  const template = await Deno.readTextFile(path);
  return template.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}
