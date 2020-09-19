import { Danbooru } from "../../components/api/Danbooru";
import { E621 } from "../../components/api/E621";
import { APIPost, PostRating } from "../../components/api/responses/APIPost";
import { XM } from "../../components/api/XM";
import { Blacklist } from "../../components/data/Blacklist";
import { Page, PageDefinition } from "../../components/data/Page";
import { User } from "../../components/data/User";
import { Post } from "../../components/post/Post";
import { PostActions } from "../../components/post/PostActions";
import { RE6Module, Settings } from "../../components/RE6Module";
import { Debug } from "../../components/utility/Debug";
import { Util } from "../../components/utility/Util";
import { BlacklistEnhancer } from "./BlacklistEnhancer";

export class BetterSearch extends RE6Module {

    private static readonly PAGES_PRELOAD = 3;  // Number of pages to pre-load when `loadPrevPages` is true
    private static readonly CLICK_DELAY = 200;  // Timeout for double-click events

    private static paused = false;              // If true, stops several actions that may interfere with other modules

    private $wrapper: JQuery<HTMLElement>;      // Wrapper object containing the loading and content sections
    private $content: JQuery<HTMLElement>;      // Section containing post thumbnails
    private $quickEdit: JQuery<HTMLElement>;    // Quick tags form

    private $paginator: JQuery<HTMLElement>;    // Pagination element

    private observer: IntersectionObserver;     // Handles dynamic post rendering

    private queryTags: string[];                // Array containing the current search query
    private queryPage: string;                  // Output page, either as a number of in `a12345` / `b12345` format
    private queryLimit: number;                 // Maximum number of posts per request

    private pageResult: Promise<APIPost[]>;     // Post data, called in `prepare`, used in `create`

    private lastPage: number;                   // Last page number from the vanilla pagination
    private hasMorePages: boolean;              // If false, there are no more posts to load
    private loadingPosts: boolean;              // True value indicates that infinite scroll is loading posts

    public constructor() {
        super([PageDefinition.search, PageDefinition.favorites], true, true, [BlacklistEnhancer]);
    }

    protected getDefaultSettings(): Settings {
        return {
            enabled: true,

            imageLoadMethod: ImageLoadMethod.Disabled,      // Whether the image should be loaded as a preview, as a sample immediately, or on hover
            autoPlayGIFs: true,                             // If false, animated GIFs will use the `hover` load method even if that is set to `always`

            imageSizeChange: true,                          // If true, resizes the image in accordance with `imageWidth`
            imageWidth: 150,                                // Width if the resized image
            imageRatioChange: true,                         // If true, crops the image to ratio specified in `imageRatio`
            imageRatio: 0.9,                                // Ratio to conform to
            imageMinWidth: 50,                              // Minimum image width, when it's not being cropped
            compactMode: true,                              // Limit the height to the same value as the width, instead of 50vh

            hoverTags: false,                               // If true, adds a hover text to the image containing all of its tags

            ribbonsRel: true,                               // Relations ribbons - parent / child posts
            ribbonsFlag: true,                              // Status ribbons - flagged / pending
            ribbonsAlt: false,                              // Alternative ribbon placement
            buttonsVote: true,                              // Voting buttons
            buttonsFav: true,                               // Favorite button

            clickAction: ImageClickAction.NewTab,           // Action take when double-clicking the thumbnail

            infiniteScroll: true,                           // Seamlessly load more posts below the current ones
            loadAutomatically: true,                        // Load posts automatically while scrolling down
            loadPrevPages: false,                           // If enabled, will load 3 pages before the current one (if available)
            hidePageBreaks: true,                           // Show a visual separator between different pages
        };
    }

    public async prepare(): Promise<void> {
        await super.prepare();

        // Clear the old thumbnails during script startup
        // This won't work on first start, but that's not a big deal
        const enabled = this.fetchSettings("enabled");
        Util.LS.setItem("re621.bs.enabled", enabled + "");
        if (!enabled || !this.pageMatchesFilter()) return;

        // console.log("starting up bettersearch", $("#paginator-old, div.paginator menu").length);

        // Establish query parameters
        this.queryPage = Page.getQueryParameter("page") || "1";
        this.queryTags = (Page.getQueryParameter("tags") || "").split(" ").filter(el => el != "");
        this.queryLimit = parseInt(Page.getQueryParameter("limit")) || undefined;

        // Queue up the first API call
        // This can be done early, to prevent waiting for `create()`
        this.pageResult = this.fetchPosts();

        $("#content").attr("loading", "true");
    }

    public create(): void {
        super.create();

        // Scrape the old paginator for data
        // If the API ever starts returning the total number of results, this can be removed
        const paginator = $("#paginator-old, div.paginator menu").first();
        const curPage = parseInt(paginator.find(".current-page").text()) || -1,
            lastPage = parseInt(paginator.find(".numbered-page").last().text()) || -1;
        paginator.remove();
        this.lastPage = Math.max(curPage, lastPage);

        // Determine if there are more content pages to show
        // If the page number is numeric, that is determined by the last page scraped above
        // If it's in the a- / b- format, there is always more content to show, unless `fetchPosts()` returns false
        if (Util.Math.isNumeric(this.queryPage)) {
            const currentPage = Util.Math.clamp(parseInt(this.queryPage), 1, 750);
            this.queryPage = currentPage + "";

            if (this.lastPage < currentPage) this.lastPage = currentPage;

            this.hasMorePages = currentPage == 750
                ? true
                : currentPage < this.lastPage;

        } else if (this.queryPage.match(/(?:a|b)\d+/g)) {
            this.hasMorePages = true;
        } else {
            this.queryPage = "-1";
            this.hasMorePages = false;
        }


        // Write appropriate settings into the content wrapper
        this.createStructure();
        this.updateContentHeader();
        this.updatePageTitle(this.queryPage);

        const preloadEnabled = this.fetchSettings("loadPrevPages") && Page.getQueryParameter("nopreload") !== "true";
        Page.removeQueryParameter("nopreload");

        // Throttled scroll-resize events for other submodules
        let timer: number;
        $(window).on("scroll.re621.gen resize.re621.gen", () => {
            if (timer) return;
            if (timer == undefined) BetterSearch.trigger("scroll");
            timer = window.setTimeout(() => {
                timer = undefined;
                BetterSearch.trigger("scroll");
            }, 250);
        });

        // Event listener for article updates
        this.$content
            .on("re621:render", "post", (event) => { Post.get($(event.currentTarget)).render(); })
            .on("re621:reset", "post", (event) => { Post.get($(event.currentTarget)).reset(); })
            .on("re621:filters", "post", (event) => { Post.get($(event.currentTarget)).updateFilters(); })
            .on("re621:visibility", "post", (event) => { Post.get($(event.currentTarget)).updateVisibility(); });
        BetterSearch.on("postcount", () => { this.updatePostCount(); });
        BetterSearch.on("paginator", () => { this.reloadPaginator(); })

        const intersecting: Set<number> = new Set();
        let selectedPage = this.queryPage;
        const config = {
            root: null,
            rootMargin: "100% 50% 100% 50%",
            threshold: 0.5,
        };
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach((value) => {
                const post = Post.get($(value.target)),
                    has = intersecting.has(post.id);

                // element left the viewport
                if (has && !value.isIntersecting) {
                    // console.log("object left", id);
                    intersecting.delete(post.id);
                    post.reset();
                }
                // element entered viewport
                if (!has && value.isIntersecting) {
                    // console.log("object entered", id);
                    intersecting.add(post.id);
                    window.setTimeout(() => {
                        if (!intersecting.has(post.id)) return;
                        post.render();
                        if (post.page != selectedPage) {
                            selectedPage = post.page;
                            Page.setQueryParameter("page", selectedPage + "");
                            this.updatePageTitle(selectedPage);
                        }
                    }, 100);
                }
            })
        }, config);

        // Initial post load
        new Promise(async (resolve) => {

            let pagesLoaded = 0;

            const pageResult = await this.pageResult;
            if (pageResult.length > 0) {

                const imageRatioChange = this.fetchSettings<boolean>("imageRatioChange");

                // Preload previous pages
                // Not available for relative page numbers
                if (Util.Math.isNumeric(this.queryPage)) {

                    const currentPage = parseInt(this.queryPage);
                    const firstPage = preloadEnabled
                        ? Math.max((currentPage - BetterSearch.PAGES_PRELOAD), 1)
                        : currentPage;

                    let result: APIPost[] = [];
                    for (let i = firstPage; i < currentPage; i++) {
                        result = await this.fetchPosts(i);
                        for (const post of result) {
                            const postData = Post.make(post, i + "", imageRatioChange);
                            if (postData !== null) {
                                this.$content.append(postData.$ref);
                                this.observer.observe(postData.$ref[0]);
                            }
                        }
                        $("<post-break>")
                            .attr("id", "page-" + (i + 1))
                            .html(`Page&nbsp;${(i + 1)}`)
                            .appendTo(this.$content);

                        pagesLoaded++
                    }
                }

                // Append the current page results
                for (const post of pageResult) {
                    const postData = Post.make(post, this.queryPage, imageRatioChange);
                    if (postData !== null) {
                        this.$content.append(postData.$ref);
                        this.observer.observe(postData.$ref[0]);
                    }
                }
                pagesLoaded++;

            }

            this.$wrapper
                .removeAttr("loading")
                .attr("infscroll", "ready");

            resolve(pagesLoaded);
        }).then((pagesLoaded) => {

            this.reloadPaginator();
            this.reloadEventListeners();

            const scrollTo = $(`[page=${this.queryPage}]:visible:first`);
            if (preloadEnabled && pagesLoaded > 1 && scrollTo.length !== 0) {
                $([document.documentElement, document.body])
                    .animate({ scrollTop: scrollTo.offset().top - 30 }, 200);
            }

            BlacklistEnhancer.update();
            this.updatePostCount();
        });
    }

    /** If true, InfiniteScroll and HoverZoom are both paused */
    public static isPaused(): boolean { return BetterSearch.paused; }
    public static setPaused(state: boolean): void {
        BetterSearch.paused = state;
        BetterSearch.trigger("paginator");
    }

    /** Updates the document title with the current page number */
    private updatePageTitle(page: string): void {
        document.title =
            (this.queryTags.length == 0 ? "Posts" : this.queryTags.join(" ").replace(/_/g, " ")) +
            (page != "1" ? (" - Page " + page) : "") +
            " - " + Page.getSiteName();
    }

    /** Creates the basic module structure */
    private createStructure(): void {

        // Post Container
        this.$wrapper = $("#content")
            .attr("loading", "true");

        $("<search-loading>")
            .html(`<span><div class="lds-ellipsis"><div></div><div></div><div></div><div></div></div></span>`)
            .appendTo(this.$wrapper);

        // Search Modes
        $(`<option value="open">Fullscreen</option>`).insertAfter("#mode-box-mode option[value=edit]");
        $(`<option value="blacklist">Blacklist</option>`).insertAfter("#mode-box-mode option[value=remove-fav]");

        // Quick Edit Form
        this.$quickEdit = $("<form>")
            .attr({
                "id": "re621-quick-tags",
                "postid": "invalid",
            })
            .addClass("simple_form")
            .html(
                `<input type="hidden" name="_method" value="put">` +
                `<div class="quick-tags-container">` +
                `   <textarea name="post[tag_string]" id="re621_qedit_tags" data-autocomplete="tag-edit" class="ui-autocomplete-input" autocomplete="off"></textarea>` +
                `</div>` +
                `<div class="quick-tags-toolbar">` +
                `   <input type="submit" name="submit" value="Submit">` +
                `   <input type="button" name="cancel" value="Cancel">` +
                `   <input type="text" name="reason" placeholder="Edit Reason" title="Edit Reason" id="re621_qedit_reason">` +
                `   <input type="text" name="parent" placeholder="Parent ID" title="Parent ID" id="re621_qedit_parent">` +
                `   <select name="post[rating]" title="Rating" id="re621_qedit_rating">
                        <option value="s">Safe</option>
                        <option value="q">Questionable</option>
                        <option value="e">Explicit</option>
                    </select>` +
                `<div class="quick-tags-info">` +
                `   <span id="re621-qedit-dimensions"></span>` +
                `   <span id="re621-qedit-flags" class="display-none-important"></span>` +
                `   <a id="re621-qedit-history" href="404">history</a>` +
                `</div>` +
                `</div>`
            )
            .appendTo(this.$wrapper)
            .hide();
        this.$quickEdit.data({
            "token": $("#re621_qedit_token"),

            "info": $("#re621-qedit-dimensions"),
            "flags": $("#re621-qedit-flags"),
            "history": $("#re621-qedit-history"),

            "tags": $("#re621_qedit_tags"),
            "reason": $("#re621_qedit_reason"),
            "parent": $("#re621_qedit_parent"),
            "rating": $("#re621_qedit_rating"),
        });
        this.$quickEdit.find("input[name=cancel]").on("click", () => {
            this.$quickEdit.hide("fast");
        });
        Danbooru.Autocomplete.initialize_all();

        this.$quickEdit.on("submit", (event) => {
            event.preventDefault();
            const postID = parseInt(this.$quickEdit.attr("postid"));

            E621.Post.id(postID).put({
                post: {
                    "tag_string": this.$quickEdit.data("tags").val() + "",
                    "edit_reason": this.$quickEdit.data("reason").val() + "",
                    "parent_id": this.$quickEdit.data("parent").val() + "",
                    "rating": PostRating.fromValue(this.$quickEdit.data("rating").val() + ""),
                }
            }).then(
                (response) => {
                    Debug.log(response);

                    Post.get(postID)
                        .update(response[0]["post"])
                        .render();

                    Danbooru.notice(`Post <a href="/posts/${postID}" target="_blank">#${postID}</a> updated (<a href="/post_versions?search[post_id]=${postID}">history</a>)`);
                    this.$quickEdit.hide("fast");
                },
                (error) => {
                    Danbooru.error(`An error occurred while updating a post`);
                    console.log(error);
                    this.$quickEdit.hide("fast");
                }
            );
        });

        // Content
        this.$content = $("<search-content>")
            .appendTo(this.$wrapper);

        // Infinite Scroll
        const infscroll = $("<paginator-container>")
            .appendTo(this.$wrapper);
        $("<span>")
            .addClass("paginator-loading")
            .html(`<div class="lds-ellipsis"><div></div><div></div><div></div><div></div></div>`)
            .appendTo(infscroll);
        this.$paginator = $("<paginator>")
            .html(``)
            .appendTo(infscroll);
    }

    /** Refreshes the visible post count attribute */
    public updatePostCount(): void {
        this.$content.attr("posts", $("post:visible").length);
    }

    /** Re-renders the posts that are currently being displayed */
    public reloadRenderedPosts(): void {
        Post.find("rendered").each(post => post.render());
    }

    /** Updates the content wrapper attributes and variables */
    public updateContentHeader(): void {
        const conf = this.fetchSettings([
            "imageSizeChange", "imageWidth",
            "imageRatioChange", "imageRatio",
            "imageMinWidth", "compactMode",

            "ribbonsAlt",

            "hidePageBreaks",
        ]);

        // Scaling Settings
        this.$content.removeAttr("style");
        if (conf.imageSizeChange) this.$content.css("--img-width", conf.imageWidth + "px");
        if (conf.imageRatioChange) this.$content.css("--img-ratio", conf.imageRatio);
        else this.$content.css("--img-fit", conf.imageMinWidth + "%");
        if (conf.compactMode) this.$content.css("--img-maxheight", (conf.imageSizeChange ? conf.imageWidth : 150) + "px");

        // Alternative ribbons
        if (conf.ribbonsAlt) this.$content.attr("ribbons-alt", "true");
        else this.$content.removeAttr("ribbons-alt");

        // InfScroll separators
        if (conf.hidePageBreaks) this.$content.attr("hide-page-breaks", "true");
        else this.$content.removeAttr("hide-page-breaks");
    }

    /** Restarts various event listeners used by the module */
    public reloadEventListeners(): void {
        this.reloadModeSwitchListener();
        this.reloadInfScrollListeners();
    }

    public reloadModeSwitchListener(): void {
        this.$content.on("click", "post a", (event) => {

            const mode = $("#mode-box-mode").val();
            if (mode == "view") return;
            event.preventDefault();

            const $article = $(event.currentTarget).parent(),
                post = Post.get($article);

            switch (mode) {
                case "rating-q":
                case "rating-s":
                case "rating-e":
                case "lock-rating":
                case "lock-note":
                case "delete":
                case "undelete":
                case "approve":
                case "remove-parent":
                case "tag-script":

                case "add-to-set": { }
                case "remove-from-set": { }

                case "fake-click": {

                    // To avoid having to duplicate the functionality of every single mode,
                    // a fake article is created with all appropriate data, which is then
                    // used to trigger Danbooru's native functionality.

                    const $tempArticle = $("<article>")
                        .addClass("post-preview display-none-important")
                        .attr({
                            "id": "post_" + post.id,
                            "data-id": post.id,
                            "data-tags": post.tagString,
                        })
                        .appendTo("body");
                    $("<a>").appendTo($tempArticle)
                        .one("click", (event) => {
                            Danbooru.PostModeMenu.click(event);
                            window.setTimeout(() => {
                                $tempArticle.remove();
                            }, 500);
                        })[0].click();
                    break;
                }
                case "open": {
                    XM.Util.openInTab(post.file.original, false);
                    break;
                }
                case "blacklist": {
                    Blacklist.toggleBlacklistTag("id:" + post.id);
                    break;
                }
                case "vote-up": {
                    const firstVote = post.$ref.attr("vote") == undefined;

                    PostActions.vote(post.id, 1, firstVote).then(
                        (response) => {
                            Debug.log(response);

                            if (response.action == 0) {
                                if (firstVote) post.$ref.attr("vote", "1");
                                else post.$ref.attr("vote", "0");
                            } else post.$ref.attr("vote", response.action);

                            post.score = response.score;
                            post.$ref.trigger("re621:update");
                        },
                        (error) => {
                            Danbooru.error("An error occurred while recording the vote");
                            console.log(error);
                        }
                    );
                    break;
                }
                case "vote-down": {
                    const firstVote = post.$ref.attr("vote") == undefined;

                    PostActions.vote(post.id, -1, false).then(
                        (response) => {
                            Debug.log(response);

                            if (response.action == 0) {
                                if (firstVote) post.$ref.attr("vote", "1");
                                else post.$ref.attr("vote", "0");
                            } else post.$ref.attr("vote", response.action);

                            post.score = response.score;
                            post.$ref.trigger("re621:update");
                        },
                        (error) => {
                            Danbooru.error("An error occurred while recording the vote");
                            console.log(error);
                        }
                    );
                    break;
                }
                case "add-fav": {
                    // TODO Replace with PostActions
                    E621.Favorites.post({ "post_id": post.id });
                    post.is_favorited = true;
                    post.$ref.attr("fav", "true");
                    break;
                }
                case "remove-fav": {
                    // TODO Replace with PostActions
                    E621.Favorite.id(post.id).delete();
                    post.is_favorited = false;
                    post.$ref.removeAttr("fav");
                    break;
                }
                case "edit": {
                    if ($("body").attr("data-sticky-header") == "true") this.$quickEdit.css("top", $("#top").height() + "px");
                    else this.$quickEdit.css("top", "");

                    this.$quickEdit.show("fast");
                    this.$quickEdit.attr("postid", post.id)

                    const ratio = Util.formatRatio(post.img.width, post.img.height);
                    this.$quickEdit.data("info").html(`${post.img.width} x ${post.img.height} (${ratio[0]}:${ratio[1]}), ${Util.formatBytes(post.file.size)}`);
                    this.$quickEdit.data("flags")
                        .toggleClass("display-none-important", post.flags.size == 0)
                        .html(post.flags.size > 0 ? [...post.flags].join(", ") : "");
                    this.$quickEdit.data("history").attr("href", `https://e621.net/post_versions?search[post_id]=${post.id}`);

                    this.$quickEdit.data("tags").val(post.tagString + " ").trigger("re621:input").focus();
                    this.$quickEdit.data("reason").val("");
                    this.$quickEdit.data("parent").val(post.rel.parent);
                    this.$quickEdit.data("rating").val(post.rating);
                    break;
                }
                default: {
                    Danbooru.error("Unknown mode");
                    break;
                }

            }

            // console.log(post.id, mode);

        });
    }

    /** Restarts the even listeners used by the infinite scroll submodule. */
    private reloadInfScrollListeners(): void {
        const fullpage = $(document),
            viewport = $(window);

        BetterSearch.off("scroll.infscroll");

        // Disable auto-loading if a post limit is specified
        if (!this.fetchSettings("infiniteScroll") || !this.fetchSettings("loadAutomatically") || this.queryLimit !== undefined) return;

        BetterSearch.on("scroll.infscroll", () => {

            // If there aren't any more posts, there's no need to keep checking this
            if (!this.hasMorePages) {
                BetterSearch.off("scroll.infscroll");
                return;
            }

            // Systems are paused
            if (BetterSearch.paused) return;

            // Don't double-queue the loading process
            if (this.loadingPosts) return;

            // The next page should start loading either:
            // - when the user is one screen's height away from the bottom
            // - when the user is 90% though the page
            // The larger of the values (lower on the page) is chosen.
            // The former works best when a lot of pages are loaded, the latter - when there isn't a lot of content

            const pageHeight = fullpage.height(),
                viewHeight = viewport.height();

            //   vv   bottom of the viewport    vv              vv  one screen away  vv    vv    90% through    vv
            if ((viewport.scrollTop() + viewHeight) < Math.max((pageHeight - viewHeight), (fullpage.height() * 0.9))) return;

            // Trigger the loading process by clicking on "Load More" button
            $("#infscroll-next")[0].click();

        });
    }

    /** Retrieves post data from an appropriate API endpoint */
    private async fetchPosts(page?: number | string): Promise<APIPost[]> {
        if (Page.matches(PageDefinition.favorites)) {
            const userID = Page.getQueryParameter("user_id") || User.getUserID();
            return E621.Favorites.get<APIPost>({ user_id: userID, page: page ? page : this.queryPage, limit: this.queryLimit }, 500)
        }

        const parsedTags = [];
        for (const tag of this.queryTags)
            parsedTags.push(decodeURIComponent(tag));

        return E621.Posts.get<APIPost>({ tags: parsedTags, page: page ? page : this.queryPage, limit: this.queryLimit }, 500);
    }

    /** Loads the next page of results */
    private async loadNextPage(): Promise<boolean> {

        this.queryPage = Util.Math.isNumeric(this.queryPage)
            ? this.queryPage = (parseInt(this.queryPage) + 1) + ""
            : this.queryPage = "b" + Post.get($("post:last")).id;

        const search = await this.fetchPosts(this.queryPage);
        if (search.length == 0) return Promise.resolve(false);

        const imageRatioChange = this.fetchSettings<boolean>("imageRatioChange");

        $("<post-break>")
            .attr("id", "page-" + this.queryPage)
            .html(`Page&nbsp;${this.queryPage}`)
            .appendTo(this.$content);

        for (const post of search) {

            // Check if the post is already present on the page
            if (Post.get(post.id) !== null) continue;

            const postData = Post.make(post, this.queryPage, imageRatioChange);
            if (postData !== null) {
                this.$content.append(postData.$ref);
                this.observer.observe(postData.$ref[0]);
            }
        }

        Page.setQueryParameter("page", this.queryPage + "");
        BetterSearch.trigger("tracker.update");
        BlacklistEnhancer.update();
        this.updatePostCount();

        BetterSearch.trigger("pageload");

        if (Util.Math.isNumeric(this.queryPage))
            return Promise.resolve(parseInt(this.queryPage) < this.lastPage);
        else return Promise.resolve(true);
    }

    /** Rebuilds the DOM structure of the paginator */
    public reloadPaginator(): void {

        this.$paginator.html("");

        // PREV
        if (this.queryPage == "1") {
            $("<span>")
                .html(`<i class="fas fa-angle-double-left"></i> Previous`)
                .addClass("paginator-prev")
                .appendTo(this.$paginator);
        } else {
            $("<a>")
                .attr("href", getPrevPageURL(this.queryPage))
                .html(`<i class="fas fa-angle-double-left"></i> Previous`)
                .addClass("paginator-prev")
                .appendTo(this.$paginator);
        }

        // LOAD
        if (this.fetchSettings("infiniteScroll")) {
            const loadMoreWrap = $("<span>")
                .addClass("infscroll-next-wrap")
                .appendTo(this.$paginator);
            const loadMoreCont = $("<span>")
                .addClass("infscroll-next-cont")
                .appendTo(loadMoreWrap);
            if (this.hasMorePages) {
                $("<a>")
                    .html("Load More")
                    .attr("id", "infscroll-next")
                    .appendTo(loadMoreCont)
                    .one("click", (event) => {
                        event.preventDefault();

                        this.loadingPosts = true;
                        this.$wrapper.attr("infscroll", "loading");
                        this.loadNextPage().then((result) => {
                            this.hasMorePages = result;
                            this.$wrapper.attr("infscroll", "ready");
                            this.reloadPaginator();
                            this.loadingPosts = false;
                        });
                    });
                $("<span>")
                    .addClass("infscroll-manual")
                    .html((BetterSearch.paused || !this.fetchSettings("loadAutomatically")) ? "Manual Mode" : "&nbsp;")
                    .appendTo(loadMoreCont);
            } else {
                $("<span>")
                    .html("No More Posts")
                    .attr("id", "infscroll-next")
                    .appendTo(loadMoreCont)
            }
        } else $("<span>").appendTo(this.$paginator);

        // NEXT
        if (this.hasMorePages) {
            $("<a>")
                .attr("href", getNextPageURL(this.queryPage))
                .html(`Next <i class="fas fa-angle-double-right"></i>`)
                .addClass("paginator-next")
                .appendTo(this.$paginator);
        } else {
            $("<span>")
                .html(`Next <i class="fas fa-angle-double-right"></i>`)
                .addClass("paginator-next")
                .appendTo(this.$paginator);
        }

        // PAGE
        const pages = $("<div>")
            .addClass("paginator-numbers")
            .appendTo(this.$paginator);

        if (Util.Math.isNumeric(this.queryPage)) {
            const currentPage = parseInt(this.queryPage);
            const pageNum: number[] = [];

            let count = 0;
            for (let i = 1; i <= this.lastPage; i++) {
                if (
                    Util.Math.between(i, 0, (currentPage < 5 ? 5 : 3)) ||
                    Util.Math.between(i, currentPage - 2, currentPage + 2) ||
                    Util.Math.between(i, (currentPage < 5 ? (this.lastPage - 5) : (this.lastPage - 3)), this.lastPage)
                ) {
                    pageNum.push(i);
                    count++;
                } else {
                    if (pageNum[count - 1] !== null) {
                        pageNum.push(null);
                        count++;
                    }
                }
            }

            for (const page of pageNum) {
                if (page == null) $("<span>").html(`. . .`).appendTo(pages);
                else {
                    if (page == currentPage) $("<span>").html(`<b>${page}</b>`).appendTo(pages);
                    else $("<a>").attr("href", getPageURL(page)).html(`${page}`).appendTo(pages);
                }
            }
        }

        function getPrevPageURL(page: string): string {

            // Default pagination
            if (Util.Math.isNumeric(page)) return getPageURL(parseInt(page) - 1);

            // Relative pagination
            const lookup = $("post:first");
            if (lookup.length == 0) return null;

            return getPageURL("a" + Post.get(lookup).id);
        }

        function getNextPageURL(page: string): string {

            // Default pagination
            if (Util.Math.isNumeric(page)) {
                const pageNum = parseInt(page);
                if (pageNum < 750) return getPageURL(parseInt(page) + 1);
            }

            // Relative pagination
            const lookup = $("post:last");
            if (lookup.length == 0) return null;

            return getPageURL("b" + Post.get(lookup).id);
        }

        function getPageURL(page: number | string): string {
            const url = new URL(window.location.toString())
            url.searchParams.set("page", page + "");
            url.searchParams.set("nopreload", "true");
            return url.pathname + url.search;
        }

    }

}

export enum ImageLoadMethod {
    Disabled = "disabled",
    Hover = "hover",
    Always = "always",
}

export enum ImageClickAction {
    Disabled = "disabled",
    NewTab = "newtab",
    CopyID = "copyid",
    Blacklist = "blacklist",
    AddToSet = "addtoset",
    ToggleSet = "toggleset",
}