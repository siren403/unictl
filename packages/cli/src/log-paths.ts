import { join } from "path";

export type ProjectEditorLogFiles = {
  state_dir: string;
  editor_log_file: string;
  compile_lifecycle_file: string;
  upm_log_file: string;
  log_scope: "editor_session";
};

export function getProjectEditorLogFiles(projectRoot: string): ProjectEditorLogFiles {
  const stateDir = join(projectRoot, "Library", "unictl-state");
  return {
    state_dir: stateDir,
    editor_log_file: join(stateDir, "editor-current.log"),
    compile_lifecycle_file: join(stateDir, "compile-lifecycle.json"),
    upm_log_file: join(stateDir, "upm-current.log"),
    log_scope: "editor_session",
  };
}
