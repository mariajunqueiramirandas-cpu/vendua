package br.com.vendua.impressora.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.com.vendua.impressora.BuildConfig
import br.com.vendua.impressora.api.ConnectionState
import br.com.vendua.impressora.api.Printer
import br.com.vendua.impressora.service.LastResult
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@Composable
fun HomeScreen(vm: MainViewModel) {
    val storeName by vm.state.storeName.collectAsStateWithLifecycle()
    val connection by vm.state.connection.collectAsStateWithLifecycle()
    val printers by vm.state.printers.collectAsStateWithLifecycle()
    val lastResults by vm.state.lastResults.collectAsStateWithLifecycle()
    val update by vm.state.availableUpdate.collectAsStateWithLifecycle()
    val updating by vm.updating.collectAsStateWithLifecycle()
    val testing by vm.testing.collectAsStateWithLifecycle()
    var adding by rememberSaveable { mutableStateOf(false) }
    var confirmDisconnect by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current

    ScreenColumn {
        StatusCard(storeName, connection)
        update?.let {
            Spacer(Modifier.height(12.dp))
            UpdateBanner(it, updating, vm::installUpdate)
        }
        Spacer(Modifier.height(12.dp))
        SetupChecklist()
        Spacer(Modifier.height(24.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Impressoras",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            TextButton(onClick = vm::refreshPrinters, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("Procurar impressoras")
            }
        }
        Spacer(Modifier.height(8.dp))
        if (printers.isEmpty()) {
            Text(
                "Nenhuma impressora ainda. Adicione uma impressora Bluetooth ou USB a este aparelho, " +
                    "ou cadastre uma impressora de rede no painel da loja.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = { context.openUrl(ADMIN_PRINTERS_URL) }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("Abrir o painel")
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                printers.forEach { p ->
                    PrinterCard(p, lastResults[p.id], testing = p.id in testing, onTest = { vm.testPrint(p) })
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = { adding = true }, modifier = Modifier.fillMaxWidth().height(BigButtonHeight)) {
            Icon(Icons.Filled.Add, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Adicionar impressora", style = MaterialTheme.typography.titleMedium)
        }
        Spacer(Modifier.height(32.dp))
        TextButton(
            onClick = { confirmDisconnect = true },
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text("Desconectar este aparelho") }
        Text(
            "Versão ${BuildConfig.VERSION_NAME}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(vertical = 8.dp),
        )
    }

    if (adding) AddPrinterDialog(vm, onDismiss = { adding = false })

    if (confirmDisconnect) {
        AlertDialog(
            onDismissRequest = { confirmDisconnect = false },
            title = { Text("Desconectar este aparelho?") },
            text = {
                Text(
                    "Ele vai parar de imprimir os pedidos da loja. Para voltar a imprimir aqui, " +
                        "será preciso conectar de novo com um código.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDisconnect = false
                        vm.disconnect()
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("Desconectar") }
            },
            dismissButton = { TextButton(onClick = { confirmDisconnect = false }) { Text("Cancelar") } },
        )
    }
}

@Composable
private fun StatusCard(storeName: String, connection: ConnectionState) {
    val status = LocalStatusColors.current
    val (color, label) = when (connection) {
        ConnectionState.ONLINE -> status.ok to "Conectado — os pedidos saem automaticamente"
        ConnectionState.CONNECTING -> status.warn to "Conectando…"
        ConnectionState.OFFLINE -> MaterialTheme.colorScheme.error to "Sem conexão. Tentando de novo…"
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp)) {
            Text("Loja", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                storeName.ifBlank { "Sua loja" },
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(color)
                Spacer(Modifier.width(10.dp))
                Text(label, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

@Composable
fun Dot(color: Color) {
    Box(Modifier.size(12.dp).background(color, CircleShape))
}

@Composable
private fun UpdateBanner(version: String, updating: Boolean, onUpdate: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Nova versão $version", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Atualize para receber as melhorias.", style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.width(12.dp))
            Button(onClick = onUpdate, enabled = !updating, modifier = Modifier.heightIn(min = 48.dp)) {
                if (updating) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("Atualizar")
                }
            }
        }
    }
}

@Composable
private fun PrinterCard(printer: Printer, last: LastResult?, testing: Boolean, onTest: () -> Unit) {
    val status = LocalStatusColors.current
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(printer.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                kindLabel(printer),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                when {
                    last == null -> {
                        Dot(status.idle)
                        Spacer(Modifier.width(8.dp))
                        Text("Nenhuma impressão ainda", style = MaterialTheme.typography.bodyMedium)
                    }
                    last.ok -> {
                        Dot(status.ok)
                        Spacer(Modifier.width(8.dp))
                        Text("Imprimiu ${formatTime(last.at)}", style = MaterialTheme.typography.bodyMedium)
                    }
                    else -> {
                        Dot(MaterialTheme.colorScheme.error)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Falhou ${formatTime(last.at)}: ${last.error.orEmpty()}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = onTest, enabled = !testing, modifier = Modifier.heightIn(min = 48.dp)) {
                if (testing) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                }
                Text("Imprimir teste")
            }
        }
    }
}

private fun kindLabel(p: Printer): String {
    val kind = when (p.kind) {
        "bluetooth" -> "Bluetooth"
        "usb" -> "USB"
        "tcp" -> "Rede"
        "spooler" -> "Windows"
        "serial" -> "Serial"
        else -> p.kind
    }
    return if (p.address.isBlank()) kind else "$kind · ${p.address}"
}

private val ptBR: Locale = Locale.forLanguageTag("pt-BR")

private fun formatTime(at: Long): String {
    val then = Calendar.getInstance().apply { timeInMillis = at }
    val now = Calendar.getInstance()
    val sameDay = then.get(Calendar.YEAR) == now.get(Calendar.YEAR) &&
        then.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR)
    val pattern = if (sameDay) "'às' HH:mm" else "'em' dd/MM 'às' HH:mm"
    return SimpleDateFormat(pattern, ptBR).format(Date(at))
}
