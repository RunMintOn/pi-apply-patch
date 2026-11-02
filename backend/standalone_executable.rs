// Based on OpenAI Codex apply-patch/src/standalone_executable.rs at
// c22a06c18070c3e33bd2648c7210a00a2a9f6f80 (Apache-2.0).
// Modified to return original output, confirmed operations and before/after text.
use std::io::Read;
use std::io::Write;

use serde_json::Value;
use serde_json::json;

pub fn main() -> ! {
    std::process::exit(run_main());
}

fn uses_diff_protocol() -> bool {
    std::env::var("PI_CODEX_APPLY_PATCH_PROTOCOL").as_deref() == Ok("2")
}

fn emit(
    exit_code: i32,
    stdout: String,
    stderr: String,
    changes: Option<Value>,
    file_changes: Option<Value>,
) -> i32 {
    let mut response = json!({
        "version": 1,
        "exitCode": exit_code,
        "stdout": stdout,
        "stderr": stderr,
        "changes": changes,
    });
    // Already-loaded v1 adapters must keep working while the helper is rebuilt.
    if uses_diff_protocol() {
        response["version"] = json!(2);
        response["fileChanges"] = file_changes.unwrap_or(Value::Null);
    }
    let mut output = std::io::stdout().lock();
    if serde_json::to_writer(&mut output, &response).is_err()
        || writeln!(output).is_err()
        || output.flush().is_err()
    {
        return 1;
    }
    exit_code
}

fn input_error(exit_code: i32, message: String) -> i32 {
    emit(exit_code, String::new(), message, None, None)
}

fn describe_changes(delta: &crate::AppliedPatchDelta) -> Value {
    let operations: Vec<Value> = delta
        .changes()
        .iter()
        .map(|change| {
            let path = change.path.inferred_native_path_string();
            match &change.change {
                crate::AppliedPatchFileChange::Add { .. } => {
                    json!({ "operation": "add", "path": path })
                }
                crate::AppliedPatchFileChange::Delete { .. } => {
                    json!({ "operation": "delete", "path": path })
                }
                crate::AppliedPatchFileChange::Update { move_path, .. } => match move_path {
                    Some(destination) => json!({
                        "operation": "move",
                        "path": path,
                        "moveTo": destination.inferred_native_path_string(),
                    }),
                    None => json!({ "operation": "update", "path": path }),
                },
            }
        })
        .collect();
    json!({ "exact": delta.is_exact(), "operations": operations })
}

fn describe_file_changes(delta: &crate::AppliedPatchDelta) -> Value {
    let mut operations = Vec::new();
    let mut moves = Vec::new();
    for change in delta.changes() {
        let path = change.path.inferred_native_path_string();
        match &change.change {
            crate::AppliedPatchFileChange::Add {
                content,
                overwritten_content,
            } => operations.push(json!({
                "path": path, "before": overwritten_content, "after": content,
            })),
            crate::AppliedPatchFileChange::Delete { content } => operations.push(json!({
                "path": path, "before": content, "after": null,
            })),
            crate::AppliedPatchFileChange::Update {
                move_path,
                old_content,
                overwritten_move_content,
                new_content,
            } => match move_path {
                Some(destination) => {
                    let destination_path = destination.inferred_native_path_string();
                    operations.push(json!({
                        "path": path, "before": old_content, "after": null,
                    }));
                    // A move onto its own path writes, then removes that same file.
                    if destination != &change.path {
                        operations.push(json!({
                            "path": destination_path,
                            "before": overwritten_move_content,
                            "after": new_content,
                        }));
                    }
                    moves.push(json!({ "path": path, "moveTo": destination_path }));
                }
                None => operations.push(json!({
                    "path": path, "before": old_content, "after": new_content,
                })),
            },
        }
    }
    json!({ "exact": delta.is_exact(), "operations": operations, "moves": moves })
}

pub fn run_main() -> i32 {
    let mut args = std::env::args_os();
    let _argv0 = args.next();
    let patch_arg = match args.next() {
        Some(arg) => match arg.into_string() {
            Ok(patch) => patch,
            Err(_) => {
                return input_error(
                    1,
                    "Error: apply_patch requires a UTF-8 PATCH argument.\n".to_string(),
                );
            }
        },
        None => {
            let mut patch = String::new();
            match std::io::stdin().read_to_string(&mut patch) {
                Ok(_) => {
                    if patch.is_empty() {
                        return input_error(
                            2,
                            "Usage: apply_patch 'PATCH'\n       echo 'PATCH' | apply_patch\n"
                                .to_string(),
                        );
                    }
                    patch
                }
                Err(error) => {
                    return input_error(
                        1,
                        format!("Error: Failed to read PATCH from stdin.\n{error}\n"),
                    );
                }
            }
        }
    };
    if args.next().is_some() {
        return input_error(
            2,
            "Error: apply_patch accepts exactly one argument.\n".to_string(),
        );
    }
    let cwd = match codex_utils_absolute_path::AbsolutePathBuf::current_dir() {
        Ok(cwd) => cwd,
        Err(error) => {
            return input_error(
                1,
                format!("Error: Failed to determine current directory.\n{error}\n"),
            );
        }
    };
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            return input_error(
                1,
                format!("Error: Failed to initialize runtime.\n{error}\n"),
            );
        }
    };
    let cwd = codex_utils_path_uri::PathUri::from_abs_path(&cwd);
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let result = runtime.block_on(crate::apply_patch(
        &patch_arg,
        &cwd,
        &mut stdout,
        &mut stderr,
        codex_exec_server::LOCAL_FS.as_ref(),
        /*sandbox*/ None,
    ));
    let (exit_code, changes, file_changes) = match result {
        Ok(delta) => (
            0,
            None,
            uses_diff_protocol().then(|| describe_file_changes(&delta)),
        ),
        Err(failure) => (
            1,
            Some(describe_changes(failure.delta())),
            uses_diff_protocol().then(|| describe_file_changes(failure.delta())),
        ),
    };
    emit(
        exit_code,
        String::from_utf8_lossy(&stdout).into_owned(),
        String::from_utf8_lossy(&stderr).into_owned(),
        changes,
        file_changes,
    )
}
