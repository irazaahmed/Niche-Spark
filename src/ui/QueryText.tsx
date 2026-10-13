/** Shows a query; a trailing space (which changes Google's suggestions) is shown as a "space" tag. */
export function QueryText({ text, className }: { text: string; className?: string }) {
  if (!text.endsWith(' ')) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {text.trimEnd()}
      <span className="query-space" title="This query ends with a space, so Google suggests the next word.">
        {' '}+ space
      </span>
    </span>
  );
}
