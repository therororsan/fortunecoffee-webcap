// Vercel serverless function to return Supabase configuration
// Environment variables (set in Vercel dashboard):
// - SUPABASE_URL
// - SUPABASE_ANON_KEY

export default function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      error: 'Supabase configuration not set. Contact administrator.',
      url: supabaseUrl ? 'OK' : 'missing',
      key: supabaseAnonKey ? 'OK' : 'missing',
    });
  }

  res.status(200).json({
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
  });
}
