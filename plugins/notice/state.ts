import { createInbox, type Inbox } from "./inbox.ts";

// The package's one inbox, held at module scope on purpose.
//
// This is a deliberate exception to the no-module-scope-instances rule: the
// instance *is* this module's public surface, and its lifetime is the
// Plugin's lifetime. The two halves of the feature — the routes that fill the
// inbox and the Plugin that draws it — have to see the same notices, and
// there is nowhere else for them to meet. A restart empties it, which V0
// accepts.
export const inbox: Inbox = createInbox();
