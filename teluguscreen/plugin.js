(function() {
  const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };

  const CDN = `${manifest.baseUrl}/movies.json`;

  async function _fetch(url) {
    const res = await http_get(url, HEADERS);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return res.body || "";
  }

  async function _fetchJson(url) {
    const body = await _fetch(url);
    try {
      return JSON.parse(body);
    } catch (e) {
      throw new Error('PARSE_ERROR: Invalid JSON response');
    }
  }

  function _movieToItem(m, baseUrl) {
    const poster = m.imagePath || m.pic || "";
    return new MultimediaItem({
      title: m.title || "Unknown",
      url: `${baseUrl}/player.html?id=${m.id}`,
      posterUrl: poster,
      type: "movie",
      year: m.year ? parseInt(m.year) : undefined,
      score: m.rating ? parseFloat(m.rating) : undefined,
      description: m.plot || "",
      contentRating: m.quality || undefined
    });
  }

  function _getMovieById(movies, id) {
    return movies.find(m => String(m.id) === String(id));
  }

  async function getHome(cb) {
    try {
      const baseUrl = manifest.baseUrl;
      const movies = await _fetchJson(CDN);

      if (!Array.isArray(movies) || movies.length === 0) {
        return cb({ success: false, errorCode: "SITE_OFFLINE", message: "No movies found" });
      }

      const home = {};

      const trending = movies
        .filter(m => m.year && m.imagePath)
        .sort((a, b) => parseInt(b.year) - parseInt(a.year))
        .slice(0, 10)
        .map(m => _movieToItem(m, baseUrl));
      if (trending.length) home["Trending"] = trending;

      const latest = movies
        .slice(0, 20)
        .map(m => _movieToItem(m, baseUrl));
      if (latest.length) home["Latest Movies"] = latest;

      const telugu = movies
        .filter(m => m.genre && m.genre.toLowerCase().includes("telugu"))
        .slice(0, 20)
        .map(m => _movieToItem(m, baseUrl));
      if (telugu.length) home["Telugu Movies"] = telugu;

      const hdrip = movies
        .filter(m => m.quality === "HDRip")
        .slice(0, 20)
        .map(m => _movieToItem(m, baseUrl));
      if (hdrip.length) home["HDRip Movies"] = hdrip;

      cb({ success: true, data: home });
    } catch (e) {
      cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
    }
  } // Added the missing closing brace here

  async function search(query, cb) {
    try {
      const baseUrl = manifest.baseUrl;
      const movies = await _fetchJson(CDN);
      const q = query.toLowerCase();

      const results = movies
        .filter(m =>
          (m.title && m.title.toLowerCase().includes(q)) ||
          (m.year && m.year.includes(q)) ||
          (m.genre && m.genre.toLowerCase().includes(q)) ||
          (m.actors && m.actors.toLowerCase().includes(q)) ||
          (m.director && m.director.toLowerCase().includes(q))
        )
        .slice(0, 50)
        .map(m => _movieToItem(m, baseUrl));

      cb({ success: true, data: results });
    } catch (e) {
      cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
    }
  }

  async function load(url, cb) {
    try {
      const baseUrl = manifest.baseUrl;
      const movies = await _fetchJson(CDN);

      const idMatch = url.match(/[?&]id=(\d+)/) || url.match(/\/(\d+)(?:\.html)?$/);
      if (!idMatch) {
        return cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid movie URL" });
      }
      const movieId = idMatch[1];
      const m = _getMovieById(movies, movieId);

      if (!m) {
        return cb({ success: false, errorCode: "NOT_FOUND", message: "Movie not found" });
      }

      const poster = m.imagePath || m.pic || "";
      const episodes = [new Episode({
        name: "Full Movie",
        url: url,
        season: 1,
        episode: 1,
        description: m.plot || "",
        posterUrl: poster
      })];

      const movie = new MultimediaItem({
        title: m.title || "Unknown",
        url: url,
        posterUrl: poster,
        type: "movie",
        year: m.year ? parseInt(m.year) : undefined,
        score: m.rating ? parseFloat(m.rating) : undefined,
        description: m.plot || "",
        contentRating: m.quality || undefined,
        episodes: episodes
      });

      cb({ success: true, data: movie });
    } catch (e) {
      cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack });
    }
  }

  async function loadStreams(url, cb) {
    try {
      const baseUrl = manifest.baseUrl;
      const movies = await _fetchJson(CDN);

      const idMatch = url.match(/[?&]id=(\d+)/) || url.match(/\/(\d+)(?:\.html)?$/);
      if (!idMatch) {
        return cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid movie URL" });
      }
      const movieId = idMatch[1];
      const m = _getMovieById(movies, movieId);

      if (!m) {
        return cb({ success: false, errorCode: "NOT_FOUND", message: "Movie not found" });
      }

      const streams = [];

      if (m.qualities && typeof m.qualities === 'object') {
        const qualityMap = { "Q360p": "360p", "Q480p": "480p", "Q720p": "720p" };
        for (const [key, value] of Object.entries(m.qualities)) {
          if (key !== "Sizes" && value && value.startsWith("http")) {
            streams.push(new StreamResult({
              url: value,
              quality: qualityMap[key] || key.replace("Q", ""),
              headers: { "Referer": baseUrl }
            }));
          }
        }
      }

      if (m.moviePath360p) streams.push(new StreamResult({ url: m.moviePath360p, quality: "360p", headers: { "Referer": baseUrl } }));
      if (m.moviePath480p) streams.push(new StreamResult({ url: m.moviePath480p, quality: "480p", headers: { "Referer": baseUrl } }));
      if (m.moviePath720p) streams.push(new StreamResult({ url: m.moviePath720p, quality: "720p", headers: { "Referer": baseUrl } }));
      if (m.moviePath && !streams.find(s => s.url === m.moviePath)) {
        streams.push(new StreamResult({ url: m.moviePath, quality: m.quality1 || "HD", headers: { "Referer": baseUrl } }));
      }

      if (streams.length === 0) {
        return cb({ success: false, errorCode: "NO_STREAMS", message: "No streaming URLs found" });
      }

      cb({ success: true, data: streams });
    } catch (e) {
      cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack });
    }
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
