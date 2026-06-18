use crate::domain::ai::{AiProfile, AiTextRequest};
use crate::domain::note::{
    CreateNoteInput, CreateNotebookInput, InsertImageResult, MarkdownBeautifyRequest,
    MarkdownBeautifyResult, MarkdownImportRequest,
    MarkdownImportResult, Note, NoteDetail, NoteOutlineItem, NoteTreeNode,
    RenameNotebookResult, SaveNoteInput, SaveNoteResult,
};
use crate::error::AppError;
use crate::error::AppResult;
use crate::services::ai::{
    load_ai_profile_with_secret, resolve_ai_profile_selection, AiOrchestrator, SystemSecretStore,
};
use crate::services::note::{
    create_note_service, create_notebook_service, delete_note_service, delete_notebook_service,
    get_note_by_path_service, get_note_outline_service, get_note_tree_service,
    import_markdown_sources_service, import_note_service, insert_image_for_note_from_selected_path,
    insert_pasted_image_for_note_from_bytes, insert_pasted_image_for_note_from_native_clipboard,
    move_note_in_root, read_clipboard_text_for_paste_in_root, rename_note_service, rewrite_pasted_remote_images_in_text,
    rename_notebook_service,
    reorder_notebooks_service, save_note_service,
    update_notebook_visual_service,
};
use crate::services::markdown_beautify::{
    beautify_markdown_text_with_ai_attempt, build_markdown_beautify_ai_request,
};
use crate::state::AppState;
use rusqlite::Connection;
use std::future::Future;
use std::path::Path;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;
use ulid::Ulid;

const MARKDOWN_BEAUTIFY_STREAM_EVENT: &str = "markdown-beautify:stream";

struct MarkdownBeautifyAiAttempt {
    candidate: Option<String>,
    unavailable_detail: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct MarkdownBeautifyStreamEventPayload {
    request_id: String,
    #[serde(rename = "type")]
    event_type: &'static str,
    chunk: Option<String>,
    result: Option<MarkdownBeautifyResult>,
    error: Option<String>,
}

#[derive(serde::Serialize)]
pub struct RewritePastedRemoteImagesResult {
    text: String,
}

async fn pick_image_file(app: &AppHandle) -> Result<Option<std::path::PathBuf>, AppError> {
    let (sender, receiver) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"])
        .pick_file(move |file_path| {
            let result = file_path.map(|value| {
                value.into_path().map_err(|error| {
                    AppError::InvalidInput(format!("Invalid selected image path: {}", error))
                })
            });
            let _ = sender.send(result);
        });

    match receiver.await {
        Ok(Some(Ok(path))) => Ok(Some(path)),
        Ok(Some(Err(error))) => Err(error),
        Ok(None) => Ok(None),
        Err(_) => Err(AppError::Io("Image picker did not return a selection".into())),
    }
}

#[tauri::command]
pub async fn create_note(
    state: State<'_, AppState>,
    directory: String,
    title: String,
) -> Result<crate::domain::note::Note, AppError> {
    create_note_service(&state, CreateNoteInput { directory, title })
}

#[tauri::command]
pub async fn create_notebook(
    state: State<'_, AppState>,
    name: String,
    icon: String,
    color: String,
) -> Result<String, AppError> {
    create_notebook_service(&state, CreateNotebookInput { name, icon, color })
}

#[tauri::command]
pub async fn get_note_by_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<NoteDetail, AppError> {
    get_note_by_path_service(&state, &path)
}

#[tauri::command]
pub async fn get_note_outline(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<NoteOutlineItem>, AppError> {
    get_note_outline_service(&state, &path)
}

#[tauri::command]
pub async fn save_note(
    state: State<'_, AppState>,
    note_id: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<SaveNoteResult, AppError> {
    save_note_service(&state, SaveNoteInput { note_id, content, expected_hash })
}

#[tauri::command]
pub async fn get_note_tree(
    state: State<'_, AppState>,
) -> Result<Vec<NoteTreeNode>, AppError> {
    get_note_tree_service(&state)
}

#[tauri::command]
pub async fn import_note(
    state: State<'_, AppState>,
    src_path: String,
    dest_directory: String,
) -> Result<crate::domain::note::Note, AppError> {
    import_note_service(&state, &src_path, &dest_directory)
}

#[tauri::command]
pub async fn import_markdown_sources(
    state: State<'_, AppState>,
    request: MarkdownImportRequest,
) -> Result<MarkdownImportResult, AppError> {
    import_markdown_sources_service(&state, request)
}

#[tauri::command]
pub async fn beautify_markdown(
    state: State<'_, AppState>,
    request: MarkdownBeautifyRequest,
) -> Result<MarkdownBeautifyResult, AppError> {
    let ai_attempt = {
        let root = {
            let root_guard = state.kb_root_guard();
            root_guard.as_ref().cloned()
        };

        let generator = || {
            let root = root.clone();
            let request_text = request.content.clone();
            let request_path = request.note_path.clone();
            let selected_request = build_markdown_beautify_ai_request(&request_path, &request_text);

            async move {
                let Some(root) = root else {
                    return Ok(MarkdownBeautifyAiAttempt {
                        candidate: None,
                        unavailable_detail: None,
                    });
                };

                let ai_context = {
                    let db_guard = state.db_guard();
                    let Some(conn) = db_guard.as_ref() else {
                        return Ok(MarkdownBeautifyAiAttempt {
                            candidate: None,
                            unavailable_detail: None,
                        });
                    };

                    prepare_markdown_beautify_ai_context(conn, &root)?
                };

                let Some((profile, api_key)) = ai_context else {
                    return Ok(MarkdownBeautifyAiAttempt {
                        candidate: None,
                        unavailable_detail: None,
                    });
                };

                let effective_request = effective_markdown_beautify_ai_request(&profile, selected_request);

                request_markdown_beautify_ai_candidate(profile, api_key, effective_request).await
            }
        };

        maybe_generate_markdown_beautify_ai_candidate(&request.options, generator).await?
    };

    finalize_markdown_beautify_result(
        &request.note_path,
        &request.content,
        request.options,
        ai_attempt,
    )
}

#[tauri::command]
pub async fn beautify_markdown_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    request: MarkdownBeautifyRequest,
    request_id: String,
) -> Result<String, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard.as_ref().cloned()
    };

    let ai_context = if request.options.use_ai_assist {
        match root.as_ref() {
            Some(root) => {
                let db_guard = state.db_guard();
                let conn = db_guard
                    .as_ref()
                    .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
                prepare_markdown_beautify_ai_context(conn, root)?
            }
            None => None,
        }
    } else {
        None
    };

    let stream_request_id = request_id.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match finalize_markdown_beautify_result(
            &request.note_path,
            &request.content,
            request.options.clone(),
            MarkdownBeautifyAiAttempt {
                candidate: None,
                unavailable_detail: None,
            },
        ) {
            Ok(result) => {
                let _ = app_handle.emit(
                    MARKDOWN_BEAUTIFY_STREAM_EVENT,
                    MarkdownBeautifyStreamEventPayload {
                        request_id: stream_request_id.clone(),
                        event_type: "rule_result",
                        chunk: None,
                        result: Some(result),
                        error: None,
                    },
                );
            }
            Err(error) => {
                let _ = app_handle.emit(
                    MARKDOWN_BEAUTIFY_STREAM_EVENT,
                    MarkdownBeautifyStreamEventPayload {
                        request_id: stream_request_id,
                        event_type: "error",
                        chunk: None,
                        result: None,
                        error: Some(error.to_string()),
                    },
                );
                return;
            }
        }

        let ai_attempt = if let Some((profile, api_key)) = ai_context {
            let selected_request = build_markdown_beautify_ai_request(&request.note_path, &request.content);
            let effective_request = effective_markdown_beautify_ai_request(&profile, selected_request);
            request_markdown_beautify_ai_candidate_streaming(
                profile,
                api_key,
                effective_request,
                &app_handle,
                &stream_request_id,
            )
            .await
        } else {
            Ok(MarkdownBeautifyAiAttempt {
                candidate: None,
                unavailable_detail: None,
            })
        };

        let result = match ai_attempt {
            Ok(ai_attempt) => finalize_markdown_beautify_result(
                &request.note_path,
                &request.content,
                request.options,
                ai_attempt,
            ),
            Err(error) => Err(error),
        };

        match result {
            Ok(result) => {
                let _ = app_handle.emit(
                    MARKDOWN_BEAUTIFY_STREAM_EVENT,
                    MarkdownBeautifyStreamEventPayload {
                        request_id: stream_request_id,
                        event_type: "completed",
                        chunk: None,
                        result: Some(result),
                        error: None,
                    },
                );
            }
            Err(error) => {
                let _ = app_handle.emit(
                    MARKDOWN_BEAUTIFY_STREAM_EVENT,
                    MarkdownBeautifyStreamEventPayload {
                        request_id: stream_request_id,
                        event_type: "error",
                        chunk: None,
                        result: None,
                        error: Some(error.to_string()),
                    },
                );
            }
        }
    });

    Ok(request_id)
}

async fn maybe_generate_markdown_beautify_ai_candidate<F, Fut>(
    options: &crate::domain::note::MarkdownBeautifyOptions,
    generator: F,
) -> AppResult<MarkdownBeautifyAiAttempt>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = AppResult<MarkdownBeautifyAiAttempt>>,
{
    if !options.use_ai_assist {
        return Ok(MarkdownBeautifyAiAttempt {
            candidate: None,
            unavailable_detail: None,
        });
    }

    generator().await
}

fn finalize_markdown_beautify_result(
    note_path: &str,
    content: &str,
    options: crate::domain::note::MarkdownBeautifyOptions,
    ai_attempt: MarkdownBeautifyAiAttempt,
) -> AppResult<MarkdownBeautifyResult> {
    beautify_markdown_text_with_ai_attempt(
        note_path,
        content,
        options,
        ai_attempt.candidate.as_deref(),
        ai_attempt.unavailable_detail,
    )
}

fn effective_markdown_beautify_ai_request(
    profile: &AiProfile,
    mut request: AiTextRequest,
) -> AiTextRequest {
    request.max_tokens = match (request.max_tokens, profile.max_tokens) {
        (Some(request_max), Some(profile_max)) => Some(request_max.max(profile_max)),
        (Some(request_max), None) => Some(request_max),
        (None, Some(profile_max)) => Some(profile_max),
        (None, None) => None,
    };

    request
}

fn prepare_markdown_beautify_ai_context(
    conn: &Connection,
    kb_root: &Path,
) -> AppResult<Option<(AiProfile, String)>> {
    let selected_profile_id = match resolve_ai_profile_selection(conn, None) {
        Ok(profile_id) => profile_id,
        Err(error) => {
            eprintln!("[mynote:beautify] skipping AI assist: {error}");
            return Ok(None);
        }
    };

    let Some(selected_profile_id) = selected_profile_id else {
        return Ok(None);
    };

    let (profile, api_key) = match load_ai_profile_with_secret(
        conn,
        &SystemSecretStore,
        kb_root,
        &selected_profile_id,
    ) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("[mynote:beautify] skipping AI assist: {error}");
            return Ok(None);
        }
    };

    if !profile.enabled {
        return Ok(None);
    }

    Ok(Some((profile, api_key)))
}

async fn request_markdown_beautify_ai_candidate(
    profile: AiProfile,
    api_key: String,
    request: AiTextRequest,
) -> AppResult<MarkdownBeautifyAiAttempt> {
    let orchestrator = AiOrchestrator::default();
    let prefer_openai_compat = should_retry_beautify_with_openai_compat(&profile);
    let response_result = match profile.provider {
        crate::domain::ai::AiProviderKind::Anthropic if !prefer_openai_compat => {
            let mut aggregated = String::new();
            let primary_result = orchestrator
                .invoke_text_stream(&profile, &api_key, &request, &mut |chunk| {
                    aggregated.push_str(&chunk);
                    Ok(())
                })
                .await
                .map(|mut response| {
                    if response.text.is_empty() {
                        response.text = aggregated;
                    }
                    response
                });

            match primary_result {
                Ok(response) => Ok(response),
                Err(primary_error) if should_retry_beautify_with_openai_compat(&profile) => {
                    let fallback_profile = make_openai_compat_fallback_profile(&profile);
                    orchestrator.invoke_text(&fallback_profile, &api_key, &request).await.or(Err(primary_error))
                }
                Err(primary_error) => Err(primary_error),
            }
        }
        crate::domain::ai::AiProviderKind::Anthropic => {
            let fallback_profile = make_openai_compat_fallback_profile(&profile);
            invoke_openai_compat_stream_for_beautify(&orchestrator, &fallback_profile, &api_key, &request).await
        }
        _ => invoke_openai_compat_stream_for_beautify(&orchestrator, &profile, &api_key, &request).await,
    };

    let response = match response_result {
        Ok(response) => response,
        Err(error) => {
            eprintln!("[mynote:beautify] AI assist failed: {error}");
            return Ok(MarkdownBeautifyAiAttempt {
                candidate: None,
                unavailable_detail: Some(error.to_string()),
            });
        }
    };

    Ok(MarkdownBeautifyAiAttempt {
        candidate: Some(response.text),
        unavailable_detail: None,
    })
}

async fn invoke_openai_compat_stream_for_beautify(
    orchestrator: &AiOrchestrator,
    profile: &AiProfile,
    api_key: &str,
    request: &AiTextRequest,
) -> AppResult<crate::domain::ai::AiTextResponse> {
    let mut aggregated = String::new();
    orchestrator
        .invoke_text_stream(profile, api_key, request, &mut |chunk| {
            aggregated.push_str(&chunk);
            Ok(())
        })
        .await
        .map(|mut response| {
            if response.text.is_empty() {
                response.text = aggregated;
            }
            response
        })
}

async fn request_markdown_beautify_ai_candidate_streaming(
    profile: AiProfile,
    api_key: String,
    request: AiTextRequest,
    app_handle: &AppHandle,
    request_id: &str,
) -> AppResult<MarkdownBeautifyAiAttempt> {
    let orchestrator = AiOrchestrator::default();
    let prefer_openai_compat = should_retry_beautify_with_openai_compat(&profile);
    let stream_request_id = request_id.to_string();
    let mut aggregated = String::new();

    let mut emit_chunk = |chunk: String| {
        aggregated.push_str(&chunk);
        app_handle
            .emit(
                MARKDOWN_BEAUTIFY_STREAM_EVENT,
                MarkdownBeautifyStreamEventPayload {
                    request_id: stream_request_id.clone(),
                    event_type: "ai_delta",
                    chunk: Some(chunk),
                    result: None,
                    error: None,
                },
            )
            .map_err(|error| AppError::Io(format!("Failed to emit markdown beautify stream delta: {error}")))
    };

    let response_result = match profile.provider {
        crate::domain::ai::AiProviderKind::Anthropic if !prefer_openai_compat => {
            orchestrator
                .invoke_text_stream(&profile, &api_key, &request, &mut emit_chunk)
                .await
        }
        crate::domain::ai::AiProviderKind::Anthropic => {
            let fallback_profile = make_openai_compat_fallback_profile(&profile);
            orchestrator
                .invoke_text_stream(&fallback_profile, &api_key, &request, &mut emit_chunk)
                .await
        }
        _ => {
            orchestrator
                .invoke_text_stream(&profile, &api_key, &request, &mut emit_chunk)
                .await
        }
    };

    let response = match response_result {
        Ok(mut response) => {
            if response.text.is_empty() {
                response.text = aggregated;
            }
            response
        }
        Err(error) => {
            eprintln!("[mynote:beautify] AI assist failed: {error}");
            return Ok(MarkdownBeautifyAiAttempt {
                candidate: None,
                unavailable_detail: Some(error.to_string()),
            });
        }
    };

    Ok(MarkdownBeautifyAiAttempt {
        candidate: Some(response.text),
        unavailable_detail: None,
    })
}

fn should_retry_beautify_with_openai_compat(profile: &AiProfile) -> bool {
    matches!(profile.provider, crate::domain::ai::AiProviderKind::Anthropic)
        && profile
            .base_url
            .as_deref()
            .is_some_and(|base_url| base_url.trim_end_matches('/').ends_with("/anthropic"))
}

fn make_openai_compat_fallback_profile(profile: &AiProfile) -> AiProfile {
    let fallback_base_url = profile.base_url.as_deref().map(|base_url| {
        let trimmed = base_url.trim_end_matches('/');
        trimmed
            .strip_suffix("/anthropic")
            .unwrap_or(trimmed)
            .to_string()
    });

    AiProfile {
        provider: crate::domain::ai::AiProviderKind::OpenAiCompatible,
        base_url: fallback_base_url,
        ..profile.clone()
    }
}

#[tauri::command]
pub async fn insert_image_for_note(
    state: State<'_, AppState>,
    app: AppHandle,
    note_path: String,
) -> Result<Option<InsertImageResult>, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let selected_path = pick_image_file(&app).await?;
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let random_source = Ulid::new().to_string().to_ascii_lowercase();
    let random_suffix = random_source.chars().take(6).collect::<String>();

    insert_image_for_note_from_selected_path(
        &root,
        &note_path,
        selected_path.as_deref(),
        &timestamp,
        &random_suffix,
    )
}

#[tauri::command]
pub async fn insert_pasted_image_for_note(
    state: State<'_, AppState>,
    note_path: String,
    mime_type: String,
    image_bytes: Vec<u8>,
) -> Result<InsertImageResult, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let random_source = Ulid::new().to_string().to_ascii_lowercase();
    let random_suffix = random_source.chars().take(6).collect::<String>();

    insert_pasted_image_for_note_from_bytes(
        &root,
        &note_path,
        &mime_type,
        &image_bytes,
        &timestamp,
        &random_suffix,
    )
}

#[tauri::command]
pub async fn insert_pasted_image_from_clipboard_for_note(
    state: State<'_, AppState>,
    note_path: String,
) -> Result<Option<InsertImageResult>, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let random_source = Ulid::new().to_string().to_ascii_lowercase();
    let random_suffix = random_source.chars().take(6).collect::<String>();

    let result = insert_pasted_image_for_note_from_native_clipboard(
        &root,
        &note_path,
        &timestamp,
        &random_suffix,
    )?;

    Ok(result)
}

#[tauri::command]
pub async fn rewrite_pasted_remote_images(
    state: State<'_, AppState>,
    note_path: String,
    text: String,
) -> Result<RewritePastedRemoteImagesResult, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let random_source = Ulid::new().to_string().to_ascii_lowercase();
    let random_suffix = random_source.chars().take(6).collect::<String>();

    let rewritten = rewrite_pasted_remote_images_in_text(
        &root,
        &note_path,
        &text,
        &timestamp,
        &random_suffix,
    ).await?;

    Ok(RewritePastedRemoteImagesResult { text: rewritten })
}

#[tauri::command]
pub async fn read_clipboard_text_for_paste(
    state: State<'_, AppState>,
    note_path: String,
) -> Result<Option<RewritePastedRemoteImagesResult>, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let random_source = Ulid::new().to_string().to_ascii_lowercase();
    let random_suffix = random_source.chars().take(6).collect::<String>();

    let text = read_clipboard_text_for_paste_in_root(
        &root,
        &note_path,
        &timestamp,
        &random_suffix,
    ).await?;

    Ok(text.map(|text| RewritePastedRemoteImagesResult { text }))
}

#[tauri::command]
pub async fn move_note(
    state: State<'_, AppState>,
    source_path: String,
    target_directory: String,
) -> Result<Note, AppError> {
    println!(
        "[mynote:note-drag] command move_note source_path={} target_directory={}",
        source_path, target_directory
    );

    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    move_note_in_root(conn, &root, &source_path, &target_directory)
}

#[tauri::command]
pub async fn rename_notebook(
    state: State<'_, AppState>,
    old_path: String,
    new_name: String,
) -> Result<RenameNotebookResult, AppError> {
    rename_notebook_service(&state, &old_path, &new_name)
}

#[tauri::command]
pub async fn rename_note(
    state: State<'_, AppState>,
    note_path: String,
    new_name: String,
) -> Result<Note, AppError> {
    rename_note_service(&state, &note_path, &new_name)
}

#[tauri::command]
pub async fn update_notebook_visual(
    state: State<'_, AppState>,
    notebook_path: String,
    icon: String,
    color: String,
) -> Result<(), AppError> {
    update_notebook_visual_service(&state, &notebook_path, &icon, &color)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ai::{AiProfile, AiProviderKind};
    use crate::domain::note::MarkdownBeautifyAiStatus;
    use crate::domain::note::MarkdownBeautifyOptions;
    use mockito::Server;
    use std::sync::{Arc, Mutex};

    fn default_options() -> MarkdownBeautifyOptions {
        MarkdownBeautifyOptions {
            fix_syntax: true,
            refresh_toc: true,
            normalize_headings: true,
            normalize_code_blocks: true,
            normalize_spacing: true,
            use_ai_assist: false,
        }
    }

    #[tokio::test]
    async fn beautify_ai_candidate_helper_skips_generator_when_disabled() {
        let called = Arc::new(Mutex::new(false));
        let flag = Arc::clone(&called);

        let result = maybe_generate_markdown_beautify_ai_candidate(&default_options(), move || {
            *flag.lock().unwrap() = true;
            async {
                Ok(MarkdownBeautifyAiAttempt {
                    candidate: Some("# AI".into()),
                    unavailable_detail: None,
                })
            }
        })
        .await
        .unwrap();

        assert_eq!(result.candidate, None);
        assert_eq!(result.unavailable_detail, None);
        assert!(!*called.lock().unwrap());
    }

    #[tokio::test]
    async fn beautify_ai_candidate_helper_invokes_generator_when_enabled() {
        let mut options = default_options();
        options.use_ai_assist = true;
        let called = Arc::new(Mutex::new(false));
        let flag = Arc::clone(&called);

        let result = maybe_generate_markdown_beautify_ai_candidate(&options, move || {
            *flag.lock().unwrap() = true;
            async {
                Ok(MarkdownBeautifyAiAttempt {
                    candidate: Some("# AI Candidate".into()),
                    unavailable_detail: None,
                })
            }
        })
        .await
        .unwrap();

        assert_eq!(result.candidate.as_deref(), Some("# AI Candidate"));
        assert_eq!(result.unavailable_detail, None);
        assert!(*called.lock().unwrap());
    }

    fn make_ai_profile(max_tokens: Option<u32>) -> AiProfile {
        AiProfile {
            id: "profile-1".into(),
            name: "Test".into(),
            provider: AiProviderKind::Anthropic,
            model: "demo-model".into(),
            base_url: None,
            max_tokens,
            temperature: Some(0.2),
            enabled: true,
        }
    }

    #[test]
    fn beautify_ai_request_uses_minimum_large_token_budget_when_profile_is_unset() {
        let request = build_markdown_beautify_ai_request("notes/demo.md", "# Title");
        let profile = make_ai_profile(None);

        let effective = effective_markdown_beautify_ai_request(&profile, request);

        assert_eq!(effective.max_tokens, Some(20_000));
    }

    #[test]
    fn beautify_ai_request_keeps_larger_profile_token_budget() {
        let request = build_markdown_beautify_ai_request("notes/demo.md", "# Title");
        let profile = make_ai_profile(Some(32_000));

        let effective = effective_markdown_beautify_ai_request(&profile, request);

        assert_eq!(effective.max_tokens, Some(32_000));
    }

    #[tokio::test]
    async fn beautify_ai_candidate_request_accepts_streaming_anthropic_response() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/messages")
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(concat!(
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"# AI\"}}\n\n",
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\" Candidate\"}}\n\n",
                "event: message_delta\n",
                "data: {\"type\":\"message_delta\",\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}\n\n",
                "event: message_stop\n",
                "data: {\"type\":\"message_stop\"}\n\n"
            ))
            .create_async()
            .await;

        let profile = AiProfile {
            base_url: Some(server.url()),
            ..make_ai_profile(Some(20_000))
        };

        let attempt = request_markdown_beautify_ai_candidate(
            profile,
            "sk-anthropic-test".into(),
            build_markdown_beautify_ai_request("notes/demo.md", "# Title"),
        )
        .await
        .unwrap();

        mock.assert();
        assert_eq!(attempt.candidate.as_deref(), Some("# AI Candidate"));
        assert_eq!(attempt.unavailable_detail, None);
    }

    #[tokio::test]
    async fn beautify_ai_candidate_request_prefers_openai_for_deepseek_anthropic_base_url() {
        let mut server = Server::new_async().await;
        let anthropic_mock = server
            .mock("POST", "/anthropic/messages")
            .with_status(500)
            .with_body("anthropic failed")
            .create_async()
            .await;
        let openai_mock = server
            .mock("POST", "/chat/completions")
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "stream": true,
            })))
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"# AI\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\" Candidate\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{}}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4,\"total_tokens\":13}}\n\n",
                "data: [DONE]\n\n"
            ))
            .create_async()
            .await;

        let profile = AiProfile {
            base_url: Some(format!("{}/anthropic", server.url())),
            ..make_ai_profile(Some(20_000))
        };

        let attempt = request_markdown_beautify_ai_candidate(
            profile,
            "sk-deepseek-test".into(),
            build_markdown_beautify_ai_request("notes/demo.md", "# Title"),
        )
        .await
        .unwrap();

        assert_eq!(anthropic_mock.matched_async().await, false);
        openai_mock.assert();
        assert_eq!(attempt.candidate.as_deref(), Some("# AI Candidate"));
        assert_eq!(attempt.unavailable_detail, None);
    }

    #[test]
    fn finalize_markdown_beautify_result_propagates_unavailable_detail() {
        let mut options = default_options();
        options.use_ai_assist = true;

        let result = finalize_markdown_beautify_result(
            "notes/demo.md",
            "# Title\n\nBody",
            options,
            MarkdownBeautifyAiAttempt {
                candidate: None,
                unavailable_detail: Some("AI provider request failed with status 401 Unauthorized: bad api key".into()),
            },
        )
        .unwrap();

        assert!(matches!(result.ai_status, MarkdownBeautifyAiStatus::Unavailable));
        assert_eq!(
            result.ai_status_detail.as_deref(),
            Some("AI provider request failed with status 401 Unauthorized: bad api key"),
        );
    }
}

#[tauri::command]
pub async fn delete_notebook(
    state: State<'_, AppState>,
    notebook_path: String,
) -> Result<(), AppError> {
    delete_notebook_service(&state, &notebook_path)
}

#[tauri::command]
pub async fn delete_note(
    state: State<'_, AppState>,
    note_path: String,
) -> Result<(), AppError> {
    delete_note_service(&state, &note_path)
}

#[tauri::command]
pub async fn reorder_notebooks(
    state: State<'_, AppState>,
    ordered_paths: Vec<String>,
) -> Result<(), AppError> {
    reorder_notebooks_service(&state, &ordered_paths)
}
