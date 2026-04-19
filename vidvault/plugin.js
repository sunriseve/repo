(function () {
  // ═══════════════════════════════════════════════════════════════
  //  VidVault SkyStream Plugin
  //  Source  : https://vidvault.ru
  //  Metadata: TMDB (English · Hindi · Telugu)
  //  Streams : Direct MP4/MKV download links scraped from VidVault
  // ═══════════════════════════════════════════════════════════════

  // ── Config ────────────────────────────────────────────────────
  var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
  var TMDB_BASE = "https://api.themoviedb.org/3";
  var IMG_BASE = "https://image.tmdb.org/t/p";
  var UA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

  // ── Image helpers ─────────────────────────────────────────────
  function imgW500(p) {
    return p ? IMG_BASE + "/w500/" + p.replace(/^\//, "") : "";
  }
  function imgW1280(p) {
    return p ? IMG_BASE + "/w1280/" + p.replace(/^\//, "") : "";
  }

  // ── TMDB fetch ────────────────────────────────────────────────
  async function api(endpoint, params) {
    var qs = new URLSearchParams(
      Object.assign({ api_key: TMDB_KEY }, params || {})
    );
    var res = await http_get(TMDB_BASE + endpoint + "?" + qs, {
      headers: { "User-Agent": UA },
    });
    return JSON.parse(res.body);
  }

  // ── Build MultimediaItem from a TMDB result row ───────────────
  function mkItem(raw, forceType) {
    var isMovie =
      forceType === "movie" ||
      (!forceType && raw.media_type === "movie") ||
      (!forceType && !raw.media_type && !!raw.title);
    var type = isMovie ? "movie" : "series";
    var id = raw.id;
    var url = isMovie ? "skystream://movie/" + id : "skystream://tv/" + id;
    var year = 0;
    if (raw.release_date) year = parseInt(raw.release_date.split("-")[0]);
    else if (raw.first_air_date) year = parseInt(raw.first_air_date.split("-")[0]);
    return new MultimediaItem({
      title: raw.title || raw.name || "Unknown",
      url: url,
      posterUrl: imgW500(raw.poster_path),
      bannerUrl: imgW1280(raw.backdrop_path),
      type: type,
      year: year,
      score: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : 0,
      description: raw.overview || "",
      syncData: { tmdb: String(id) },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  getHome — Dashboard categories
  // ═══════════════════════════════════════════════════════════════
  async function getHome(cb) {
    try {
      var results = await Promise.all([
        api("/trending/all/week",   { language: "en-US" }),
        api("/movie/popular",       { language: "en-US", page: 1 }),
        api("/tv/popular",          { language: "en-US", page: 1 }),
        api("/movie/top_rated",     { language: "en-US", page: 1 }),
        api("/tv/top_rated",        { language: "en-US", page: 1 }),
        api("/discover/movie", {
          language: "en-US",
          with_original_language: "hi",
          sort_by: "popularity.desc",
          page: 1,
        }),
        api("/discover/tv", {
          language: "en-US",
          with_original_language: "hi",
          sort_by: "popularity.desc",
          page: 1,
        }),
        api("/discover/movie", {
          language: "en-US",
          with_original_language: "te",
          sort_by: "popularity.desc",
          page: 1,
        }),
        api("/discover/tv", {
          language: "en-US",
          with_original_language: "te",
          sort_by: "popularity.desc",
          page: 1,
        }),
      ]);

      var trendingRes     = results[0];
      var popMoviesRes    = results[1];
      var popTvRes        = results[2];
      var topMoviesRes    = results[3];
      var topTvRes        = results[4];
      var hindiMoviesRes  = results[5];
      var hindiTvRes      = results[6];
      var teluguMoviesRes = results[7];
      var teluguTvRes     = results[8];

      var data = {};

      function addRow(key, res, forceType, limit) {
        if (res && res.results && res.results.length) {
          data[key] = res.results.slice(0, limit || 20).map(function (r) {
            return mkItem(r, forceType);
          });
        }
      }

      addRow("Trending",        trendingRes,     null,     15);
      addRow("Popular Movies",  popMoviesRes,    "movie",  20);
      addRow("Popular TV Shows",popTvRes,        "series", 20);
      addRow("Top Rated Movies",topMoviesRes,    "movie",  20);
      addRow("Top Rated TV",    topTvRes,        "series", 20);
      addRow("Bollywood",       hindiMoviesRes,  "movie",  20);
      addRow("Hindi TV Shows",  hindiTvRes,      "series", 20);
      addRow("Telugu Movies",   teluguMoviesRes, "movie",  20);
      addRow("Telugu TV Shows", teluguTvRes,     "series", 20);

      cb({ success: true, data: data });
    } catch (e) {
      console.error("getHome Error:", e);
      cb({ success: false, message: String(e.message || e) });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  search
  // ═══════════════════════════════════════════════════════════════
  async function search(query, cb) {
    try {
      var res = await api("/search/multi", {
        language: "en-US",
        query: query,
        include_adult: false,
      });

      if (!res || !res.results || !res.results.length) {
        cb({ success: true, data: [] });
        return;
      }

      var items = res.results
        .filter(function (r) {
          return r.media_type === "movie" || r.media_type === "tv";
        })
        .slice(0, 30)
        .map(mkItem);

      cb({ success: true, data: items });
    } catch (e) {
      console.error("search Error:", e);
      cb({ success: false, message: String(e.message || e) });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  load — Full detail page with episodes
  //
  //  Incoming URL patterns:
  //    skystream://movie/{tmdbId}
  //    skystream://tv/{tmdbId}
  // ═══════════════════════════════════════════════════════════════
  async function load(url, cb) {
    try {
      var isMovie = url.indexOf("/movie/") !== -1;
      var isTv    = url.indexOf("/tv/")    !== -1;

      if (!isMovie && !isTv) {
        cb({ success: false, message: "Unknown URL: " + url });
        return;
      }

      // Extract the TMDB id — it is always the final non-empty segment
      var segs = url.split("/").filter(function (s) { return s && s !== "skystream:"; });
      var tmdbId = segs[segs.length - 1];
      var mtype  = isMovie ? "movie" : "tv";

      var fetches = await Promise.all([
        api("/" + mtype + "/" + tmdbId, { language: "en-US" }),
        api("/" + mtype + "/" + tmdbId + "/credits", { language: "en-US" }),
        api("/" + mtype + "/" + tmdbId + "/videos",  { language: "en-US" }),
      ]);

      var d       = fetches[0];
      var credits = fetches[1];
      var videos  = fetches[2];

      if (!d || !d.id) {
        cb({ success: false, message: "TMDB returned no data for id=" + tmdbId });
        return;
      }

      var title  = d.title || d.name || "Unknown";
      var genres = (d.genres || []).map(function (g) { return g.name; });

      var cast = ((credits && credits.cast) ? credits.cast : [])
        .slice(0, 12)
        .map(function (a) {
          return new Actor({
            name: a.name,
            role: a.character || "",
            image: a.profile_path ? imgW500(a.profile_path) : "",
          });
        });

      var trailers = ((videos && videos.results) ? videos.results : [])
        .filter(function (v) { return v.type === "Trailer" && v.site === "YouTube"; })
        .slice(0, 3)
        .map(function (v) {
          return new Trailer({
            name: v.name || "Trailer",
            url: "https://www.youtube.com/watch?v=" + v.key,
          });
        });

      var episodes = [];

      if (isMovie) {
        // ── Movie: single episode pointing to VidVault movie page
        episodes.push(
          new Episode({
            name: "Watch Movie",
            url: "skystream://stream/movie/" + tmdbId,
            season: 1,
            episode: 1,
            streams: [],
          })
        );
      } else {
        // ── TV Series: iterate seasons → episodes from TMDB
        var seasons = d.seasons || [];
        for (var si = 0; si < seasons.length; si++) {
          var sn = seasons[si].season_number;
          if (sn === 0) continue; // skip Specials

          var sd = await api("/tv/" + tmdbId + "/season/" + sn, { language: "en-US" });
          if (!sd || !sd.episodes || !sd.episodes.length) continue;

          for (var ei = 0; ei < sd.episodes.length; ei++) {
            var ep   = sd.episodes[ei];
            var sNum = ep.season_number;
            var eNum = ep.episode_number;
            var code = "S" + String(sNum).padStart(2, "0") +
                       "E" + String(eNum).padStart(2, "0");

            episodes.push(
              new Episode({
                name:        ep.name ? code + " \u2013 " + ep.name : code,
                url:         "skystream://stream/tv/" + tmdbId + "/" + sNum + "/" + eNum,
                season:      sNum,
                episode:     eNum,
                description: ep.overview || "",
                posterUrl:   ep.still_path ? imgW500(ep.still_path) : imgW500(d.poster_path),
                airDate:     ep.air_date  || "",
                rating:      ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : 0,
                runtime:     ep.runtime   || 0,
                streams:     [],
              })
            );
          }
        }
      }

      var statusMap = {
        Released:          "completed",
        Ended:             "completed",
        Canceled:          "completed",
        "In Production":   "ongoing",
        "Post Production": "upcoming",
        "Returning Series":"ongoing",
        Planned:           "upcoming",
      };

      var year = 0;
      if (d.release_date)   year = parseInt(d.release_date.split("-")[0]);
      else if (d.first_air_date) year = parseInt(d.first_air_date.split("-")[0]);

      var item = new MultimediaItem({
        title:          title,
        url:            url,
        posterUrl:      imgW500(d.poster_path),
        bannerUrl:      imgW1280(d.backdrop_path),
        type:           isMovie ? "movie" : "series",
        year:           year,
        score:          d.vote_average ? Math.round(d.vote_average * 10) / 10 : 0,
        description:    d.overview || "",
        genres:         genres,
        cast:           cast,
        trailers:       trailers,
        status:         statusMap[d.status] || "completed",
        playbackPolicy: "none",
        episodes:       episodes,
        syncData:       { tmdb: String(tmdbId) },
      });

      cb({ success: true, data: item });
    } catch (e) {
      console.error("load Error:", e);
      cb({ success: false, message: String(e.message || e) });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  loadStreams — Scrape VidVault and return playable links
  //
  //  Incoming URL patterns (set by Episode.url in load()):
  //    skystream://stream/movie/{tmdbId}
  //    skystream://stream/tv/{tmdbId}/{season}/{episode}
  //
  //  VidVault page URLs:
  //    https://vidvault.ru/movie/{tmdbId}
  //    https://vidvault.ru/tv/{tmdbId}/{season}/{episode}
  // ═══════════════════════════════════════════════════════════════
  async function loadStreams(url, cb) {
    try {
      // ── 1. Parse the incoming skystream URL ───────────────────
      // Strip protocol prefix and split path
      var path = url.replace(/^skystream:\/\//, "").replace(/^stream\//, "");
      // path is now  "movie/{tmdbId}"  or  "tv/{tmdbId}/{season}/{episode}"
      var parts = path.split("/");
      var mtype  = parts[0]; // "movie" | "tv"
      var tmdbId = parts[1];

      var vidvaultUrl;
      if (mtype === "movie") {
        vidvaultUrl = manifest.baseUrl + "/movie/" + tmdbId;
      } else {
        var season  = parts[2];
        var episode = parts[3];
        vidvaultUrl = manifest.baseUrl + "/tv/" + tmdbId + "/" + season + "/" + episode;
      }

      // ── 2. Fetch the VidVault HTML page ──────────────────────
      var res = await http_get(vidvaultUrl, {
        headers: {
          "User-Agent":      UA,
          "Referer":         manifest.baseUrl + "/",
          "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      var html   = res.body || "";
      var streams = [];
      var seen    = {};

      // Helper to add a stream (dedup by URL)
      function addStream(href, quality, isMkv) {
        href = href.trim();
        if (!href || seen[href]) return;
        seen[href] = true;
        var fmt = isMkv ? " [MKV]" : " [MP4]";
        streams.push(
          new StreamResult({
            url:     href,
            quality: quality + fmt,
            headers: {
              "User-Agent": UA,
              "Referer":    vidvaultUrl,
            },
          })
        );
      }

      // Quality label extractor
      var qualRe  = /(\d{3,4}p|4K|2K)/i;
      var mkvRe   = /\.mkv\b/i;
      var extRe   = /\.(mp4|mkv|webm|avi|mov)(\?[^"'\s]*)?$/i;
      var dlRe    = /\/(download|dl|file|get|serve|media)\//i;

      // ── Strategy A: Parse <a href="..."> tags ─────────────────
      // Matches: <a href="URL">...label...</a>
      var aTagRe = /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      var m;
      while ((m = aTagRe.exec(html)) !== null) {
        var href  = m[1];
        var inner = m[2].replace(/<[^>]+>/g, " ").trim(); // strip inner tags

        if (!href || href.length < 10) continue;
        if (!extRe.test(href) && !dlRe.test(href)) continue;

        var qm = qualRe.exec(inner) || qualRe.exec(href);
        var quality = qm ? qm[1].toUpperCase() : "Auto";
        addStream(href, quality, mkvRe.test(href));
      }

      // ── Strategy B: Bare file URLs anywhere in the source ─────
      if (streams.length === 0) {
        var bareRe = /(https?:\/\/[^\s"'<>]+\.(?:mp4|mkv|webm)(?:\?[^\s"'<>]*)?)/gi;
        while ((m = bareRe.exec(html)) !== null) {
          var fUrl = m[1];
          var qm2  = qualRe.exec(fUrl);
          addStream(fUrl, qm2 ? qm2[1].toUpperCase() : "Auto", mkvRe.test(fUrl));
        }
      }

      // ── Strategy C: JSON / JS object literals ─────────────────
      if (streams.length === 0) {
        var jsonRe = /["'](?:file|src|url|source|stream|path)["']\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:mp4|mkv|webm)[^"']*)/gi;
        while ((m = jsonRe.exec(html)) !== null) {
          var jUrl = m[1];
          var qm3  = qualRe.exec(jUrl);
          addStream(jUrl, qm3 ? qm3[1].toUpperCase() : "Auto", mkvRe.test(jUrl));
        }
      }

      // ── Sort: highest quality first ───────────────────────────
      var RANKS = { "4K": 10, "2160P": 9, "1440P": 8, "2K": 8,
                    "1080P": 7, "720P": 6, "480P": 5, "360P": 4,
                    "240P": 3, "AUTO": 1 };

      streams.sort(function (a, b) {
        function rank(q) {
          var up = q.toUpperCase();
          for (var k in RANKS) {
            if (up.indexOf(k) !== -1) return RANKS[k];
          }
          var n = parseInt(q);
          return isNaN(n) ? 0 : n / 100;
        }
        return rank(b.quality) - rank(a.quality);
      });

      // ── Fallback: direct link to VidVault page ────────────────
      if (streams.length === 0) {
        streams.push(
          new StreamResult({
            url:            vidvaultUrl,
            quality:        "Auto",
            headers:        { "User-Agent": UA, "Referer": manifest.baseUrl + "/" },
            playbackPolicy: "External Player Only",
          })
        );
      }

      cb({ success: true, data: streams });
    } catch (e) {
      console.error("loadStreams Error:", e);
      cb({ success: false, message: String(e.message || e) });
    }
  }

  // ─── Export all four required methods ─────────────────────────
  globalThis.getHome      = getHome;
  globalThis.search       = search;
  globalThis.load         = load;
  globalThis.loadStreams   = loadStreams;
})();
