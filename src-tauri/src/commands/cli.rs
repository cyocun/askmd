use tauri::State;

pub struct InitialPath(pub Option<String>);

#[tauri::command]
pub fn get_initial_path(state: State<'_, InitialPath>) -> Option<String> {
    state.0.clone()
}
