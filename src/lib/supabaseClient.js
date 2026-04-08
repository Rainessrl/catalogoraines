import { createClient } from '@supabase/supabase-js'

// Database Raines Supabase (txsvbwbbhjkymmjlkgqk)
const supabaseUrl = 'https://txsvbwbbhjkymmjlkgqk.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4c3Zid2JiaGpreW1tamxrZ3FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNjA1MzEsImV4cCI6MjA4NzkzNjUzMX0.Qmewu0yiHZO6TR-MKIlVjSszctIuqs15PjCNbmnsCKk';

export const SUPABASE_URL = supabaseUrl;
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
