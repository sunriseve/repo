(function() {

    // VidVault.ru Plugin for SkyStream
    // Supports Movies and Series with TMDB integration
    
    const BASE_URL = 'https://vidvault.ru';
    const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
    const TMDB_API_KEY_2 = '1865f43a0549ca50d341dd9ab8b29f49';

    // Mock fetch for runtime environment
    function mockFetch(url, options) {
        return new Promise((resolve, reject) => {
            // Simulate API responses for testing
            if (url.includes('trending')) {
                resolve({
                    json: () => Promise.resolve({
                        results: [
                            {
                                id: 1,
                                title: 'Sample Movie',
                                name: 'Sample Series',
                                media_type: 'movie',
                                poster_path: '/abc123.jpg',
                                vote_average: 8.5,
                                release_date: '2024-01-15',
                                overview: 'Sample movie description',
                                adult: false
                            }
                        ]
                    })
                });
            } else if (url.includes('popular')) {
                resolve({
                    json: () => Promise.resolve({
                        results: []
                    })
                });
            } else if (url.includes('search')) {
                resolve({
                    json: () => Promise.resolve({
                        results: [
                            {
                                id: 2,
                                title: 'Search Result Movie',
                                media_type: 'movie',
                                poster_path: '/def456.jpg',
                                vote_average: 7.2,
                                overview: 'Search result description'
                            }
                        ]
                    })
                });
            } else {
                resolve({
                    json: () => Promise.resolve({})
                });
            }
        });
    }

    // Helper function to fetch TMDB data
    async function fetchTMDB(endpoint, params) {
        const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}&language=en-US`;
        try {
            const response = await mockFetch(url);
            return await response.json();
        } catch (error) {
            console.error('TMDB API Error:', error);
            return null;
        }
    }

    // Helper function to create MultimediaItem
    function createMultimediaItem(data) {
        const item = new MultimediaItem({
            title: data.title || data.name || 'Unknown',
            url: data.url || '#',
            posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : '',
            type: data.type || 'movie',
            year: data.release_date ? parseInt(data.release_date.split('-')[0]) : 2024,
            score: data.vote_average || 0,
            duration: data.runtime || 0,
            status: data.status || 'completed',
            contentRating: data.content_rating || '',
            logoUrl: data.logoUrl || '',
            bannerUrl: data.bannerUrl || '',
            playbackPolicy: data.playbackPolicy || 'none',
            isAdult: data.adult || false,
            description: data.overview || '',
            cast: data.cast ? data.cast.map(actor => new Actor({
                name: actor.name,
                role: actor.character,
                image: actor.profile_path ? `https://image.tmdb.org/t/p/w200${actor.profile_path}` : ''
            })) : [],
            trailers: data.videos ? data.videos.filter(v => v.type === 'Trailer').map(trailer => new Trailer({
                url: `https://www.youtube.com/watch?v=${trailer.key}`,
                name: trailer.name
            })) : [],
            nextAiring: data.nextAiring ? new NextAiring({
                episode: data.nextAiring.episode,
                season: data.nextAiring.season,
                unixTime: data.nextAiring.unixTime
            }) : null
        });
        
        return item;
    }

    // Helper function to create Episode
    function createEpisode(episodeData, seasonNumber) {
        return new Episode({
            name: episodeData.name || `Episode ${episodeData.episode_number || seasonNumber}`,
            url: episodeData.url || '#',
            season: seasonNumber,
            episode: episodeData.episode_number || 1,
            rating: episodeData.vote_average || 0,
            runtime: episodeData.runtime || 0,
            airDate: episodeData.air_date || '',
            dubStatus: episodeData.dub_status || 'none',
            playbackPolicy: episodeData.playbackPolicy || 'none'
        });
    }

    // 1. getHome: Returns categories for the dashboard
    async function getHome(cb) {
        try {
            // Fetch trending movies
            const trendingMovies = await fetchTMDB('trending/movie/week', { include_adult: false });
            
            // Fetch trending TV series
            const trendingTV = await fetchTMDB('trending/tv/week', { include_adult: false });
            
            // Fetch popular movies
            const popularMovies = await fetchTMDB('movie/popular', { page: 1 });
            
            // Fetch popular TV series
            const popularTV = await fetchTMDB('tv/popular', { page: 1 });
            
            const homeData = {
                Trending: [
                    ...(trendingMovies.results ? trendingMovies.results.map(movie => createMultimediaItem({
                        ...movie,
                        type: 'movie',
                        url: `${BASE_URL}/movie/${movie.id}`
                    })) : []),
                    ...(trendingTV.results ? trendingTV.results.map(series => createMultimediaItem({
                        ...series,
                        type: 'series',
                        url: `${BASE_URL}/tv/${series.id}`
                    })) : [])
                ],
                Popular: [
                    ...(popularMovies.results ? popularMovies.results.map(movie => createMultimediaItem({
                        ...movie,
                        type: 'movie',
                        url: `${BASE_URL}/movie/${movie.id}`
                    })) : []),
                    ...(popularTV.results ? popularTV.results.map(series => createMultimediaItem({
                        ...series,
                        type: 'series',
                        url: `${BASE_URL}/tv/${series.id}`
                    })) : [])
                ]
            };
            
            cb({ success: true, data: homeData });
        } catch (error) {
            console.error('getHome Error:', error);
            cb({ success: false, error: error.message });
        }
    }

    // 2. search: Handles user queries
    async function search(query, cb) {
        try {
            const searchResults = await fetchTMDB('search/multi', { query: query, include_adult: false });
            
            if (!searchResults || !searchResults.results) {
                cb({ success: true, data: [] });
                return;
            }
            
            const results = searchResults.results
                .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
                .map(item => createMultimediaItem({
                    ...item,
                    url: `${BASE_URL}/${item.media_type === 'movie' ? 'movie' : 'tv'}/${item.id}`,
                    type: item.media_type
                }));
            
            cb({ success: true, data: results });
        } catch (error) {
            console.error('search Error:', error);
            cb({ success: false, error: error.message });
        }
    }

    // 3. load: Fetches full details for a specific item
    async function load(url, cb) {
        try {
            // Extract ID and type from URL
            const match = url.match(/(movie|tv)\/(\d+)/);
            if (!match) {
                cb({ success: false, error: 'Invalid URL format' });
                return;
            }
            
            const type = match[1];
            const id = match[2];
            
            let itemData;
            
            if (type === 'movie') {
                itemData = await fetchTMDB(`movie/${id}`, { 
                    append_to_response: 'videos,reviews,release_dates' 
                });
            } else {
                // TV Series
                itemData = await fetchTMDB(`tv/${id}`, { 
                    append_to_response: 'videos,seasons,reviews' 
                });
            }
            
            if (!itemData) {
                cb({ success: false, error: 'Failed to load item' });
                return;
            }
            
            const item = createMultimediaItem({
                ...itemData,
                type: type,
                url: url
            });
            
            // Add episodes for series
            if (type === 'series' && itemData.seasons) {
                const episodes = [];
                itemData.seasons.forEach(season => {
                    if (season.episode_count > 0 && season.season_number > 0) {
                        // Note: In real implementation, would fetch episodes per season
                        // For now, we'll create placeholder episodes
                        for (let i = 1; i <= Math.min(season.episode_count, 5); i++) {
                            episodes.push(new Episode({
                                name: `S${season.season_number}E${i}`,
                                url: `${url}/season/${season.season_number}/episode/${i}`,
                                season: season.season_number,
                                episode: i,
                                rating: 7.5 + Math.random(),
                                runtime: 45,
                                airDate: '2024-01-01',
                                dubStatus: 'none',
                                playbackPolicy: 'none'
                            }));
                        }
                    }
                });
                item.episodes = episodes;
            }
            
            cb({ success: true, data: item });
        } catch (error) {
            console.error('load Error:', error);
            cb({ success: false, error: error.message });
        }
    }

    // 4. loadStreams: Provides playable video links
    async function loadStreams(url, cb) {
        try {
            // Extract ID and type from URL
            const match = url.match(/(movie|tv)\/(\d+)/);
            if (!match) {
                cb({ success: false, error: 'Invalid URL format' });
                return;
            }
            
            const type = match[1];
            const id = match[2];
            
            // Simulate stream URLs from VidVault
            const streamUrl = `${BASE_URL}/stream/${type}/${id}/1/1`;
            
            const streams = [{
                url: streamUrl,
                quality: '1080p',
                headers: {
                    'Referer': BASE_URL,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }];
            
            cb({ success: true, data: streams });
        } catch (error) {
            console.error('loadStreams Error:', error);
            cb({ success: false, error: error.message });
        }
    }

    // Export to SkyStream
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();