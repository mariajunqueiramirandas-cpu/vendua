package br.com.vendua.impressora.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle

const val ADMIN_PRINTERS_URL = "https://painel.vendua.com.br/admin/impressoras"

private enum class Screen { WELCOME, PAIRING, HOME }

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun AppRoot(vm: MainViewModel) {
    val paired by vm.state.paired.collectAsStateWithLifecycle()
    val pairing by vm.pairing.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var showServerDialog by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(vm) {
        vm.messages.collect { snackbar.showSnackbar(it) }
    }

    val screen = when {
        paired -> Screen.HOME
        pairing == PairingUi.Idle -> Screen.WELCOME
        else -> Screen.PAIRING
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    // Long-press is a hidden staff entry to point the app at another server.
                    Text(
                        "Venduá Impressora",
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.combinedClickable(
                            onClick = {},
                            onLongClick = { showServerDialog = true },
                            onLongClickLabel = "Configurar servidor",
                        ),
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Crossfade(targetState = screen, label = "screen", modifier = Modifier.padding(padding)) { s ->
            when (s) {
                Screen.WELCOME -> WelcomeScreen(onConnect = vm::startPairing)
                Screen.PAIRING -> PairingScreen(pairing, onRetry = vm::startPairing, onCancel = vm::cancelPairing)
                Screen.HOME -> HomeScreen(vm)
            }
        }
    }

    if (showServerDialog) {
        ServerDialog(current = vm.apiBase(), onSave = {
            vm.setApiBase(it)
            showServerDialog = false
        }, onDismiss = { showServerDialog = false })
    }
}

/** Centered, width-capped, scrollable column used by every screen (phones and tablets). */
@Composable
fun ScreenColumn(content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
        ) { content() }
    }
}

@Composable
private fun ServerDialog(current: String, onSave: (String?) -> Unit, onDismiss: () -> Unit) {
    var value by rememberSaveable { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Servidor (equipe Venduá)") },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                singleLine = true,
                label = { Text("Endereço da API") },
            )
        },
        confirmButton = { TextButton(onClick = { onSave(value) }) { Text("Salvar") } },
        dismissButton = {
            TextButton(onClick = { onSave(null) }) { Text("Usar padrão") }
        },
    )
}

fun Context.openUrl(url: String) {
    try {
        startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
    } catch (_: ActivityNotFoundException) {
    }
}

fun Context.openIntent(intent: Intent): Boolean = try {
    startActivity(intent)
    true
} catch (_: ActivityNotFoundException) {
    false
}
