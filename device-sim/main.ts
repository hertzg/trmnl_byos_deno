import { Command, EnumType } from "@cliffy/command";
import { BOARDS, identity, LOG_LEVELS, WAKE_REASONS } from "./firmware/device.ts";
import type { BoardName } from "./firmware/device.ts";
import { RequestFailed } from "./cli/http.ts";
import { getDisplay, getImage, getSetup, postLog } from "./cli/requests.ts";

// Best-effort stand-in for the TRMNL firmware's HTTP client, so a developer
// terminal can poke a locally running server without hardware. The firmware
// only ever makes four kinds of request, and each one is a subcommand:
//
//   deno task device setup              GET  /api/setup
//   deno task device display            GET  /api/display
//   deno task device image --preview    GET  the PNG /api/display points at
//   deno task device log "hello"        POST /api/log
//
// What goes on the wire lives under firmware/; this file is only the CLI.

// Object.keys() widens to string[], so name the key type back for cliffy.
const boardType = new EnumType(Object.keys(BOARDS) as BoardName[]);
const wakeType = new EnumType(WAKE_REASONS);
const levelType = new EnumType(LOG_LEVELS);

// Shown when a subcommand was invoked with nothing to do. Prints its help and
// exits non-zero, so a script can tell "I did nothing" from "I sent it".
function usage(command: { showHelp: () => void }): never {
  command.showHelp();
  Deno.exit(1);
}

// Shared by `display` and `log`, which both report the device's condition.
const telemetryOptions = {
  wake: "Update-Source header: why the device woke",
  refresh: "Refresh-Rate header: seconds it last slept",
  battery: "Battery-Voltage header, in volts",
  rssi: "RSSI header, in dBm",
} as const;

try {
  await new Command()
    .name("device")
    .description(
      "Simulate the requests a TRMNL device makes against a BYOS server.\n" +
        "One subcommand per request the firmware knows how to make.",
    )
    .globalType("board", boardType)
    .globalType("wake", wakeType)
    .globalOption("-b, --base <url:string>", "Server base url.", {
      default: "http://localhost:3000",
    })
    .globalOption(
      "-d, --board <name:board>",
      "Board to emulate: sets Model, panel size, gauge headers.",
      { default: "x" },
    )
    .globalOption("--id <mac:string>", "ID header.", {
      default: "AA:BB:CC:DD:EE:FF",
    })
    .globalOption("--token <key:string>", "Access-Token header.", {
      default: "byos",
    })
    .globalOption("--fw <version:string>", "FW-Version header.", {
      default: "1.8.14",
    })
    .globalOption(
      "--width <px:integer>",
      "Width header. Defaults to the board's panel.",
    )
    .globalOption(
      "--height <px:integer>",
      "Height header. Defaults to the board's panel.",
    )
    .globalOption(
      "--debug",
      "Log the full exchange: request headers and body, response headers and body.",
      { default: false },
    )
    .action(function () {
      this.showHelp();
    })
    .command("setup", "GET /api/setup — the once-per-registration handshake.")
    .action((options) => getSetup(identity(options), options.debug))
    .command(
      "display",
      "GET /api/display — the poll the device makes on every wake.",
    )
    .option("--wake <reason:wake>", telemetryOptions.wake, { default: "timer" })
    .option("--refresh <seconds:integer>", telemetryOptions.refresh, {
      default: 900,
    })
    .option("--battery <volts:number>", telemetryOptions.battery, {
      default: 3.9,
    })
    .option("--rssi <dbm:integer>", telemetryOptions.rssi, { default: -55 })
    .option("--cached", "Send Image-Cached: true.", { default: false })
    .action((options) =>
      getDisplay(identity(options), {
        wake: options.wake,
        refreshRate: options.refresh,
        battery: options.battery,
        rssi: options.rssi,
        cached: options.cached,
      }, options.debug)
    )
    .command(
      "image [url:string]",
      "GET the rendered image, with --preview or --out. Without a url, asks /api/display for it.",
    )
    .option(
      "--preview",
      "Open the image in a viewer and block until it is closed.",
      {
        default: false,
      },
    )
    .option("--out <path:file>", "Download the image to this path and keep it.")
    .action(function (options, url) {
      // Downloading has to be asked for: --preview to look at it, --out to
      // keep it. With neither there is nothing to do with the bytes, so say
      // so rather than quietly leaving a file in the temp dir. Exits non-zero
      // because nothing was sent — a caller chaining on `&&` should not
      // read this as success.
      if (!options.preview && options.out === undefined) return usage(this);
      return getImage(identity(options), url, {
        preview: options.preview,
        out: options.out,
        debug: options.debug,
      });
    })
    .command(
      "log [message:string]",
      "POST /api/log — the log batch the device uploads.",
    )
    .type("level", levelType)
    .option("--level <level:level>", "Log level of the entry.", {
      default: "info",
    })
    .option("--wake <reason:wake>", telemetryOptions.wake, { default: "timer" })
    .option("--refresh <seconds:integer>", telemetryOptions.refresh, {
      default: 900,
    })
    .option("--battery <volts:number>", telemetryOptions.battery, {
      default: 3.9,
    })
    .option("--rssi <dbm:integer>", telemetryOptions.rssi, { default: -55 })
    .action(function (options, message) {
      if (message === undefined) return usage(this);
      return postLog(
        identity(options),
        {
          wake: options.wake,
          refreshRate: options.refresh,
          battery: options.battery,
          rssi: options.rssi,
          cached: false,
        },
        message,
        options.level,
        options.debug,
      );
    })
    .parse(Deno.args);
} catch (error) {
  // Anything else is a bug in this tool, and its stack is worth seeing.
  if (!(error instanceof RequestFailed)) throw error;
  console.error(`error: ${error.message}`);
  Deno.exit(1);
}
