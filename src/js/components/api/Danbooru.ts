/* Type definitions for the Danbooru Javascript methods */

import { XM } from "./XM";

export class Danbooru {

    private static getModules(): any { return XM.Window["Danbooru"]; }
    private static hasModules(): boolean { return XM.Window["Danbooru"] !== undefined; }

    public static Blacklist: DanbooruBlacklist = {
        apply(): void {
            if (Danbooru.hasModules()) Danbooru.getModules()["Blacklist"].apply();
            else XM.Chrome.execInjectorRequest("Danbooru", "Blacklist", "apply");

        },

        initialize_anonymous_blacklist(): void {
            if (Danbooru.hasModules()) Danbooru.getModules()["Blacklist"].initialize_anonymous_blacklist();
            else XM.Chrome.execInjectorRequest("Danbooru", "Blacklist", "initialize_anonymous_blacklist");

        },

        initialize_all(): void {
            if (Danbooru.hasModules()) Danbooru.getModules()["Blacklist"].initialize_all();
            else XM.Chrome.execInjectorRequest("Danbooru", "Blacklist", "initialize_all");

        },

        initialize_disable_all_blacklists(): void {
            if (Danbooru.hasModules()) Danbooru.getModules()["Blacklist"].initialize_disable_all_blacklists();
            else XM.Chrome.execInjectorRequest("Danbooru", "Blacklist", "initialize_disable_all_blacklists");

        },

        stub_vanilla_functions(): void {
            if (Danbooru.hasModules()) {
                Danbooru.getModules()["Blacklist"].apply = (): void => { return; };
                Danbooru.getModules()["Blacklist"].initialize_disable_all_blacklists = (): void => { return; };
                Danbooru.getModules()["Blacklist"].initialize_all = (): void => { return; };
            } else XM.Chrome.execInjectorRequest("Danbooru", "Blacklist", "stub_vanilla_functions");
        },
    }

    public static Post: DanbooruPost = {
        vote(postid: number, scoreDifference: number, preventUnvote?: boolean): void {
            if (Danbooru.hasModules()) Danbooru.getModules()["Post"].vote(postid, scoreDifference, preventUnvote);
            else XM.Chrome.execInjectorRequest("Danbooru", "Post", "vote", [postid, scoreDifference, preventUnvote]);

        }
    };

    public static Note: DanbooruNote = {
        Box: {
            scale_all(): void {
                if (Danbooru.hasModules()) Danbooru.getModules()["Note"]["Box"].scale_all();
                else XM.Chrome.execInjectorRequest("Danbooru", "Note.Box", "scale_all");

            }
        },

        TranslationMode: {
            active(state?: boolean): Promise<boolean> {
                if (Danbooru.hasModules()) {
                    if (state !== undefined) Danbooru.getModules()["Note"]["TranslationMode"].active = state;
                    return Promise.resolve(Danbooru.getModules()["Note"]["TranslationMode"].active);
                } else return XM.Chrome.execInjectorRequest("Danbooru", "Note.TranslationMode", "active", [state]);

            },

            toggle(): void {
                if (Danbooru.hasModules()) Danbooru.getModules()["Note"]["TranslationMode"].toggle(new CustomEvent("re621.dummy-event"));
                else XM.Chrome.execInjectorRequest("Danbooru", "Note.TranslationMode", "toggle");

            },
        }
    };

    public static Thumbnails = {

        initialize(): void {
            if (Danbooru.hasModules()) Danbooru.getModules()["Thumbnails"].initialize();
            else XM.Chrome.execInjectorRequest("Danbooru", "Thumbnails", "initialize");
        }

    }

    public static Utility: DanbooruUtility = {

        disableShortcuts(state?: boolean): Promise<boolean> {
            if (Danbooru.hasModules()) {
                if (state !== undefined) Danbooru.getModules()["Utility"].disableShortcuts = state;
                return Promise.resolve(Danbooru.getModules()["Utility"].disableShortcuts);
            } else return XM.Chrome.execInjectorRequest("Danbooru", "Utility", "disableShortcuts", [state]);
        },

    };

    public static E621 = {

        addDeferredPosts(posts: []): void {
            if (Danbooru.hasModules()) {
                XM.Window["___deferred_posts"] = XM.Window["___deferred_posts"] || {}
                XM.Window["___deferred_posts"] = $.extend(XM.Window["___deferred_posts"], posts);
            } else XM.Chrome.execInjectorRequest("Danbooru", "E621", "addDeferredPosts", [posts]);
        }

    }

    public static notice(input: string): void {
        if (Danbooru.hasModules())
            XM.Chrome.execInjectorRequest("Danbooru", "Notice", "notice", [input]);
        else Danbooru.getModules()["notice"](input);
    }

    public static error(input: string): void {
        if (Danbooru.hasModules())
            XM.Chrome.execInjectorRequest("Danbooru", "Notice", "error", [input]);
        else Danbooru.getModules()["error"](input);
    }
}

interface DanbooruBlacklist {
    apply(): void;
    initialize_anonymous_blacklist(): void;
    initialize_all(): void;
    initialize_disable_all_blacklists(): void;

    stub_vanilla_functions(): void;
}

interface DanbooruPost {
    vote(postid: number, scoreDifference: number, preventUnvote?: boolean): void;
}

interface DanbooruNote {
    Box: DanbooruNoteBox;
    TranslationMode: DanbooruNoteMode;
}

interface DanbooruNoteBox {
    scale_all(): void;
}

interface DanbooruNoteMode {
    active(): Promise<boolean>;
    toggle(e: Event): void;
}

interface DanbooruUtility {
    disableShortcuts(state?: boolean): Promise<boolean>;
}
