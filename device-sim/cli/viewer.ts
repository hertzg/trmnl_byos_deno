// How to put an image on screen, per platform: the command to run, and how to
// raise its window once it exists. One branch point rather than a platform
// check at each step.
//
// macOS uses qlmanage rather than `open` because closing a Quick Look window
// ends the qlmanage process, whereas Preview.app outlives its last window and
// would hang us forever. Only that path truly blocks — xdg-open hands off to a
// launcher and returns immediately, so on Linux `--preview` opens the image but
// does not wait for you to close it.
type Viewer = {
  command: Deno.Command;
  focus: (pid: number) => Promise<void>;
  // Whether waiting on the spawned process actually waits for the window.
  // qlmanage exits when its panel closes; xdg-open hands the file to a
  // launcher and returns immediately, so the window outlives the process.
  blocks: boolean;
};

function openViewer(path: string): Viewer {
  if (Deno.build.os === "darwin") {
    return {
      command: new Deno.Command("qlmanage", {
        args: ["-p", path],
        stdout: "null",
        stderr: "null",
      }),
      focus: focusQuickLook,
      blocks: true,
    };
  }
  return {
    command: new Deno.Command("xdg-open", { args: [path] }),
    focus: () => Promise.resolve(),
    blocks: false,
  };
}

// Opens the image, and where the platform's viewer allows it, waits for the
// window to close. The signal listeners cover the other half — if the terminal
// goes away the viewer goes with it, instead of being orphaned on the desktop.
//
// Returns whether it actually waited. The caller needs to know: a viewer that
// returned immediately is still about to read the file, so deleting it would
// pull the image out from under the window that is opening.
export async function previewFile(path: string): Promise<boolean> {
  const viewer = openViewer(path);
  const child = viewer.command.spawn();
  await viewer.focus(child.pid);

  const stop = () => {
    try {
      child.kill();
    } catch {
      // Already exited; nothing to close.
    }
  };
  const signals: Deno.Signal[] = ["SIGINT", "SIGHUP", "SIGTERM"];
  for (const signal of signals) Deno.addSignalListener(signal, stop);
  try {
    await child.status;
  } finally {
    for (const signal of signals) Deno.removeSignalListener(signal, stop);
  }
  return viewer.blocks;
}

// Quick Look puts its panel up behind whatever is already frontmost, so the
// image you asked to look at opens unfocused. qlmanage has no flag for this,
// so ask System Events to raise it. Matching on the pid rather than the name
// avoids stealing focus from someone else's Quick Look, and the retry covers
// the moment before the panel registers as a process. Best effort throughout:
// if System Events is unavailable or Accessibility is not granted, the
// preview still opens, just without focus.
async function focusQuickLook(pid: number): Promise<void> {
  const script = `
    tell application "System Events"
      repeat 20 times
        try
          set frontmost of (first process whose unix id is ${pid}) to true
          return
        end try
        delay 0.1
      end repeat
    end tell`;
  try {
    await new Deno.Command("osascript", {
      args: ["-e", script],
      stdout: "null",
      stderr: "null",
    }).output();
  } catch {
    // No osascript, or it refused; the window is on screen regardless.
  }
}
