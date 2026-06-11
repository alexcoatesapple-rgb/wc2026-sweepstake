import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fhwmowzzimahelflqpnq.supabase.co';

// This is the public anon key — safe to commit and ship in the browser.
// Row Level Security on the sweepstake table is what governs access.
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZod21vd3p6aW1haGVsZmxxcG5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDM4MTgsImV4cCI6MjA5Njc3OTgxOH0.ceP8Pxz2vbUDXD9nTE0hBTgWS0MzCgGL-KNTBKSE4a0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
