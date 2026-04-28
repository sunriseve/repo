(function() {
  const HEADERS = { 
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  };

  async function _fetch(url) {
    const res = await http_get(url, HEADERS);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.body || "";
  }

  async function _fetchJson(url) {
    const body = await _fetch(url);
    try { return JSON.parse(body); }
    catch (e) { throw new Error(`PARSE_ERROR for ${url}`); }
  }

  function _movieToItem(m) {
    return new MultimediaItem({
      title: m.title || "Unknown",
      url: `${m._baseUrl}/player.html?id=${m.id}`,
      posterUrl: m.imagePath || m.pic || "",
      type: "movie",
      year: m.year ? parseInt(m.year) : undefined,
      score: m.rating ? parseFloat(m.rating) : undefined,
      description: m.plot || "",
      contentRating: m.quality || undefined
    });
  }

  async function getAllMovies() {
    // Fetch both sources - NO silent error catching
    const teluguMovies = await _fetchJson("https://teluguscreen.com/movies.json");
    teluguMovies.forEach(m => m._baseUrl = "https://teluguscreen.com");

    const kannadaMovies = await _fetchJson("https://kannadascreen.com/movies.json");
    kannadaMovies.forEach(m => m._baseUrl = "https://kannadascreen.com");

    // Interleave: Telugu, Kannada, Telugu, Kannada...
    const all = [];
    const maxLen = Math.max(teluguMovies.length, kannadaMovies.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < teluguMovies.length) all.push(teluguMovies[i]);
      if (i < kannadaMovies.length) all.push(kannadaMovies[i]);
    }
    return all;
  }

  async function getMovieById(id) {
    const all = await getAllMovies();
    return all.find(m => String(m.id) === String(id));
  }

  async function getHome(cb) {
    try {
      const allMovies = await getAllMovies();
      if (!allMovies.length) return cb({ success: false, errorCode: "SITE_OFFLINE" });

      const home = {};

      const trending = allMovies
        .filter(m => m.year && m.imagePath)
        .sort((a, b) => parseInt(b.year) - parseInt(a.year))
        .slice(0, 10)
        .map(m => _movieToItem(m));
      if (trending.length) home["Trending"] = trending;

      // Combined Telugu + Kannada (interleaved)
      const latest = allMovies.slice(0, 60).map(m => _movieToItem(m));
      if (latest.length) home["Latest Movies"] = latest;

      cb({ success: true, data: home });
    } catch (e) {
      cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
    }
  }

  async function search(query, cb) {
    try {
      const allMovies = await getAllMovies();
      const q = query.toLowerCase();
      const results = allMovies
        .filter(m => 
          (m.title && m.title.toLowerCase().includes(q)) ||
          (m.year && m.year.includes(q)) ||
          (m.genre && m.genre.toLowerCase().includes(q))
        )
        .slice(0, 50)
        .map(m => _movieToItem(m));
      cb({ success: true, data: results });
    } catch (e) {
      cb({ success: false, errorCode: "PARSE_ERROR" });
    }
  }

  async function load(url, cb) {
    try {
      const idMatch = url.match(/[?&]id=(\d+)/);
      if (!idMatch) return cb({ success: false, errorCode: "PARSE_ERROR" });
      
      const m = await getMovieById(idMatch[1]);
      if (!m) return cb({ success: false, errorCode: "NOT_FOUND" });

      const movie = new MultimediaItem({
        title: m.title,
        url: url,
        posterUrl: m.imagePath || m.pic || "",
        type: "movie",
        year: m.year ? parseInt(m.year) : undefined,
        description: m.plot || "",
        episodes: [new Episode({
          name: "Full Movie",
          url: url,
          season: 1,
          episode: 1,
          description: m.plot || ""
        })]
      });
      cb({ success: true, data: movie });
    } catch (e) {
      cb({ success: false, errorCode: "PARSE_ERROR" });
    }
  }

  async function loadStreams(url, cb) {
    try {
      const idMatch = url.match(/[?&]id=(\d+)/);
      if (!idMatch) return cb({ success: false, errorCode: "PARSE_ERROR" });
      
      const m = await getMovieById(idMatch[1]);
      if (!m) return cb({ success: false, errorCode: "NOT_FOUND" });

      const streams = [];
      const qualityMap = { "Q360p": "360p", "Q480p": "480p", "Q720p": "720p" };

      if (m.qualities) {
        for (const [key, value] of Object.entries(m.qualities)) {
          if (key === "Sizes" || !value || !value.startsWith("http")) continue;
          const res = qualityMap[key] || key.replace("Q", "");
          streams.push(new StreamResult({
            url: value,
            quality: res,
            source: res,
            headers: { "Referer": m._baseUrl }
          }));
        }
      }

      const backups = [
        { url: m.moviePath360p, res: "360p" },
        { url: m.moviePath480p, res: "480p" },
        { url: m.moviePath720p, res: "720p" }
      ];
      for (const b of backups) {
        if (!b.url || streams.some(s => s.url === b.url)) continue;
        streams.push(new StreamResult({
          url: b.url,
          quality: b.res,
          source: b.res,
          headers: { "Referer": m._baseUrl }
        }));
      }

      if (!streams.length) return cb({ success: false, errorCode: "NO_STREAMS" });
      cb({ success: true, data: streams });
    } catch (e) {
      cb({ success: false, errorCode: "PARSE_ERROR" });
    }
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
