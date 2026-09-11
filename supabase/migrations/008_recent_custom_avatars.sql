-- ═══════════════════════════════════════════════════════════════
-- Migration 008: Recent Custom Avatars & Storage Deletion
-- ═══════════════════════════════════════════════════════════════

-- 1. ADD recent_custom_avatars ARRAY TO PROFILES
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS recent_custom_avatars TEXT[] DEFAULT '{}';

-- 2. STORAGE DELETE POLICY FOR AVATARS
-- Ensures users can delete their own avatar files from the storage bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Authenticated Avatar Delete'
  ) THEN
    CREATE POLICY "Authenticated Avatar Delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'avatars');
  END IF;
END $$;
