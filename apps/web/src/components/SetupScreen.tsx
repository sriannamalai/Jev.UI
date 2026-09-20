// Non-blocking notice shown when `/api/health` reports no API key
// configured (spec §9). Editing still works; the shell disables Run.
export function SetupScreen(props: { keyConfigured: boolean | undefined }) {
  if (props.keyConfigured !== false) return null;

  return (
    <div className="setup-screen" role="status">
      <b>No API key found</b>
      <span>
        Set <code>TYPESAFE_API_KEY</code> in the environment of the process that runs{' '}
        <code>jev serve</code>, then restart it. You can keep editing; Run is disabled until a key
        is configured.
      </span>
    </div>
  );
}
