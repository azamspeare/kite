export const FILE_TOOLS = ['list_project_files', 'read_project_file', 'write_project_file', 'edit_project_file'];

export const SCENE_TOOLS = [
  'get_project',
  'render_frames',
  'check_seams',
  'get_music_context',
  'set_scene_duration',
  'rename_scene',
  // A scene chat places cues in its own scene and may add (never replace) sounds.
  'list_sounds',
  'describe_sound',
  'create_sound',
  'add_sound_from_attachment',
  'generate_sound',
  'check_audio',
];
