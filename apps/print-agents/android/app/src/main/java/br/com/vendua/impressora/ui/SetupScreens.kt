package br.com.vendua.impressora.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.core.net.toUri
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.com.vendua.impressora.print.Bluetooth
import br.com.vendua.impressora.service.Notifications

/** Re-evaluated on every resume: the merchant changes these in system Settings and comes back. */
@Composable
private fun rememberResumeTick(): Int {
    var tick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        tick++
        onPauseOrDispose { }
    }
    return tick
}

private fun Context.appDetailsSettings() =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri())

/** After a second denial Android stops showing the dialog; then only Settings can grant it. */
private fun permanentlyDenied(activity: Activity?, permission: String) =
    activity != null && !ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)

@Composable
fun SetupChecklist() {
    val context = LocalContext.current
    val activity = LocalActivity.current
    val tick = rememberResumeTick()
    var refresh by remember { mutableIntStateOf(0) }
    val needsNotif = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    val needsBt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val notifOk = remember(tick, refresh) { Notifications.canPost(context) }
    val btOk = remember(tick, refresh) { Bluetooth.hasConnectPermission(context) }
    val batteryOk = remember(tick, refresh) {
        context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true
    }

    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        refresh++
        if (!granted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            permanentlyDenied(activity, Manifest.permission.POST_NOTIFICATIONS)
        ) {
            context.openIntent(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
            )
        }
    }
    val btLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        refresh++
        if (result.values.any { !it } && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            permanentlyDenied(activity, Manifest.permission.BLUETOOTH_CONNECT)
        ) {
            context.openIntent(context.appDetailsSettings())
        }
    }

    val items = buildList {
        if (needsNotif) {
            add(
                CheckItem(notifOk, "Notificações", "Mostram que a impressão automática está ativa e avisam se ela parar.", "Permitir") {
                    notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                },
            )
        }
        if (needsBt) {
            add(
                CheckItem(btOk, "Bluetooth", "Necessário para imprimir em impressoras Bluetooth.", "Permitir") {
                    btLauncher.launch(Bluetooth.runtimePermissions)
                },
            )
        }
        add(
            CheckItem(
                batteryOk,
                "Bateria sem restrição",
                "Para o Android não pausar a impressão com a tela apagada. Na lista, escolha “Todos os apps”, " +
                    "depois Venduá Impressora → Não otimizar.",
                "Abrir configuração",
            ) {
                if (!context.openIntent(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) {
                    context.openIntent(context.appDetailsSettings())
                }
            },
        )
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(vertical = 8.dp)) {
            if (items.all { it.done }) {
                Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = LocalStatusColors.current.ok)
                    Spacer(Modifier.width(12.dp))
                    Text("Tudo pronto neste aparelho", style = MaterialTheme.typography.titleMedium)
                }
            } else {
                Text(
                    "Deixe este aparelho pronto",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
                items.forEachIndexed { i, item ->
                    if (i > 0) HorizontalDivider(Modifier.padding(horizontal = 20.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    CheckRow(item)
                }
            }
        }
    }
}

private class CheckItem(
    val done: Boolean,
    val title: String,
    val body: String,
    val action: String,
    val onAction: () -> Unit,
)

@Composable
private fun CheckRow(item: CheckItem) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (item.done) {
            Icon(Icons.Filled.CheckCircle, contentDescription = "Feito", tint = LocalStatusColors.current.ok)
        } else {
            Dot(LocalStatusColors.current.warn)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            if (!item.done) {
                Text(item.body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (!item.done) {
            Spacer(Modifier.width(12.dp))
            FilledTonalButton(onClick = item.onAction, modifier = Modifier.heightIn(min = 48.dp)) { Text(item.action) }
        }
    }
}

@Composable
fun AddPrinterDialog(vm: MainViewModel, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val tick = rememberResumeTick()
    var refresh by remember { mutableIntStateOf(0) }
    val btPermitted = remember(tick, refresh) { Bluetooth.hasConnectPermission(context) }
    val bonded = remember(tick, refresh) { vm.bondedBluetooth() }
    val usb = remember(tick, refresh) { vm.usbCandidates() }
    val picked by vm.pickedBluetooth.collectAsStateWithLifecycle()
    val printers by vm.state.printers.collectAsStateWithLifecycle()
    val known = remember(picked, printers) { (picked.map { it.key } + printers.map { it.key }).toSet() }
    val btLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh++ }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Adicionar impressora") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SectionTitle("Bluetooth")
                when {
                    !btPermitted -> {
                        Text("Permita o acesso ao Bluetooth para ver as impressoras pareadas.")
                        TextButton(onClick = { btLauncher.launch(Bluetooth.runtimePermissions) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Permitir Bluetooth")
                        }
                    }
                    bonded.isEmpty() -> Text("Nenhum aparelho Bluetooth pareado.")
                    else -> bonded.forEach { c ->
                        val key = "bt:${c.mac}"
                        CandidateRow(c.name, c.mac, added = key in known) {
                            if (key in picked.map { it.key }) vm.removeBluetooth(key) else vm.addBluetooth(c)
                        }
                    }
                }
                Text(
                    "A impressora não aparece? Ligue-a e pareie nas configurações de Bluetooth " +
                        "do aparelho (o PIN costuma ser 0000 ou 1234).",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(
                    onClick = { context.openIntent(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("Abrir configurações de Bluetooth") }

                Spacer(Modifier.height(8.dp))
                SectionTitle("USB")
                if (usb.isEmpty()) {
                    Text(
                        "Nenhuma impressora USB conectada. Ligue o cabo da impressora " +
                            "(alguns aparelhos precisam de um adaptador OTG).",
                    )
                } else {
                    usb.forEach { c ->
                        val detail = if (c.permitted) c.address else "${c.address} · toque para permitir"
                        CandidateRow(c.name, detail, added = c.permitted && "usb:${c.address}" in known) {
                            vm.addUsb(c)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fechar") } },
    )
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
    )
}

@Composable
private fun CandidateRow(name: String, detail: String, added: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyLarge)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (added) {
            Icon(Icons.Filled.CheckCircle, contentDescription = "Adicionada", tint = LocalStatusColors.current.ok)
        }
    }
}
