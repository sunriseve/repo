(function() {
  const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };

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

  async function getHome(cb) {
    try {
      const baseUrl = manifest.baseUrl;
      
      // Fetch Telugu movies
      const teluguMovies = await _fetchJson(`${baseUrl}/movies.json`);
      teluguMovies.forEach(m => m.source = 'telugu');

      // Fetch Kannada movies
      let kannadaMovies = [];
      try {
        kannadaMovies = await _fetchJson(`https://kannadascreen.com/movies.json`);
        kannadaMovies.forEach(m => m.source = 'kannada');
      } catch (e) {
        console.log('Kannada fetch failed:', e.message);
      }

      const allMovies = [...teluguMovies, ...kannadaMovies];
      if (!Array.isArray(allMovies) || allMovies.length === 0) {
        return cb({ success: false, errorCode: "SITE_OFFLINE", message: "No movies found" });
      }

      const home = {};

      // Trending (hero carousel) - latest from both
      const trending = allMovies
        .filter(m => m.year && m.imagePath)
        .sort((a, b) => parseInt(b.year) - parseInt(a.year))
        .slice(0, 10)
        .map(m => _movieToItem(m, m.source === 'kannada' ? 'https://kannadascreen.com' : baseUrl));
      if (trending.length) home["Trending"] = trending;

      // Latest Movies (combined)
      const latest = allMovies.slice(0, 20).map(m =>
        _movieToItem(m, m.source === 'kannada' ? 'https://kannadascreen.com' : baseUrl)
      );
      if (latest.length) home["Latest Movies"] = latest;

      // Telugu Movies
      const telugu = allMovies.filter(m => m.source === 'telugu').slice(0, 20).map(m =>
        _movieToItem(m, baseUrl)
      );
      if (telugu.length) home["Telugu Movies"] = telugu;

      // Kannada Movies
      const kannada = allMovies.filter(m => m.source === 'kannada').slice(0, 20).map(m =>
        _movieToItem(m, 'https://kannadascreen.com')
      );
      if (kannada.length) home["Kannada Movies"] = kannada;

      // HDRip Movies (combined)
      const hdrip = allMovies.filter(m => m.quality === "HDRip").slice(0, 20).map(m =>
        _movieToItem(m, m.source === 'kannada' ? 'https://kannadascreen.com' : baseUrl)
      );
      if (hdrip.length) home["HDRip Movies"] = hdrip;

      cb({ success: true, data: home });
    } catch (e) {
      cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
    }
  }

  async function search(query, cb) {
    try {
      const baseUrl = manifest.baseUrl;
      
      // Search both sources
      const teluguMovies = await _fetchJson(`${baseUrl}/movies.json`);
      let kannadaMovies = [];
      try {
        kannadaMovies = await _fetchJson(`https://kannadascreen.com/movies.json`);
      } catch (e) {}
      
      const allMovies = [...teluguMovies, ...kannadaMovies];
      const q = query.toLowerCase();
      const results = allMovies
        .filter(m =>
          (m.title && m.title.toLowerCase().includes(q)) ||
          (m.year && m.year.includes(q)) ||
          (m.genre && m.genre.toLowerCase().includes(q)) ||
          (m.actors && m.actors.toLowerCase().includes(q)) ||
          (m.director && m.director.toLowerCase().includes(q))
        )
        .slice(0, 50)
        .map(m => _movieToItem(m, m.source === 'kannada' ? 'https://kannadascreen.com' : baseUrl));

      cb({ success: true, data: results });
    } catch (e) {
      cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
    }
  }

  async function load(url, cb) {
    try {
      const isKannada = url.includes('kannadascreen.com');
      const baseUrl = isKannada ? 'https://kannadascreen.com' : manifest.baseUrl;
      const movies = await _fetchJson(`${baseUrl}/movies.json`);

      const idMatch = url.match(/[?&]id=(\d+)/) || url.match(/\/(\d+)(?:\.html)?$/);
      if (!idMatch) {
        return cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid movie URL" });
      }
      
      const movieId = idMatch[1];
      const m = movies.find(m => String(m.id) === String(movieId));

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
      const isKannada = url.includes('kannadascreen.com');
      const baseUrl = isKannada ? 'https://kannadascreen.com' : manifest.baseUrl;
      const movies = await _fetchJson(`${baseUrl}/movies.json`);

      const idMatch = url.match(/[?&]id=(\d+)/) || url.match(/\/(\d+)(?:\.html)?$/);
      if (!idMatch) {
        return cb({ success: false, errorCode: "PARSE_ERROR", message: "Invalid movie URL" });
      }
      
      const movieId = idMatch[1];
      const m = movies.find(m => String(m.id) === String(movieId));

      if (!m) {
        return cb({ success: false, errorCode: "NOT_FOUND", message: "Movie not found" });
      }

      const streams = [];
      const qualityMap = { "Q360p": "360p", "Q480p": "480p", "Q720p": "720p" };
      const sizes = (m.qualities && m.qualities.Sizes) || {};

      // Add streams from qualities object with size labels
      if (m.qualities && typeof m.qualities === 'object') {
        for (const [key, value] of Object.entries(m.qualities)) {
          if (key !== "Sizes" && value && value.startsWith("http")) {
            const res = qualityMap[key] || key.replace("Q", "");
            const size = sizes[key] || "";
            const qualityLabel = size ? `${res} (${size})` : res;
            streams.push(new StreamResult({
              url: value,
              quality: qualityLabel,
              headers: { "Referer": baseUrl }
            }));
          }
        }
      }

      // Add backup moviePath streams with size labels
      if (m.moviePath360p && !streams.some(s => s.url === m.moviePath360p)) {
        const size = sizes["Q360p"] || "";
        streams.push(new StreamResult({
          url: m.moviePath360p,
          quality: size ? `360p (${size})` : "360p",
          headers: { "Referer": baseUrl }
        }));
      }
      if (m.moviePath480p && !streams.some(s => s.url === m.moviePath480p)) {
        const size = sizes["Q480p"] || "";
        streams.push(new StreamResult({
          url: m.moviePath480p,
          quality: size ? `480p (${size})` : "480p",
          headers: { "Referer": baseUrl }
        }));
      }

      if (m.moviePath720p && !streams.some(s => s.url === m.moviePath720p)) {
        const size = sizes["Q720p"] || "";
        streams.push(new StreamResult({
          url: m.moviePath720p,
          quality: size ? `720p (${size})` : "720p",
          headers: { "Referer": baseUrl }
        }));
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
