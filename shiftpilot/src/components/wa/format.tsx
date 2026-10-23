import { Fragment, type ReactNode } from "react";

/** WhatsApp text formatting: *bold* _italic_ ~strike~ `mono`, links, line breaks */
export function WaText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  return (
    <span className={className}>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {formatLine(line)}
          {i < lines.length - 1 && <br />}
        </Fragment>
      ))}
    </span>
  );
}

const TOKEN = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`|https?:\/\/\S+)/g;

function formatLine(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const tok = m[0];
    const inner = tok.slice(1, -1);
    if (tok.startsWith("*")) out.push(<strong key={k++} className="font-semibold">{inner}</strong>);
    else if (tok.startsWith("_")) out.push(<em key={k++}>{inner}</em>);
    else if (tok.startsWith("~")) out.push(<s key={k++}>{inner}</s>);
    else if (tok.startsWith("`")) out.push(<code key={k++} className="font-mono text-[0.92em]">{inner}</code>);
    else
      out.push(
        <a key={k++} href={tok} target="_blank" rel="noreferrer" className="text-[#027EB5] underline">
          {tok}
        </a>,
      );
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
