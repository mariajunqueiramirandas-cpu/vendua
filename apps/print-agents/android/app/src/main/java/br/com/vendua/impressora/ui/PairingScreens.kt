package br.com.vendua.impressora.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.util.Locale

val BigButtonHeight = 56.dp

@Composable
fun WelcomeScreen(onConnect: () -> Unit) {
    ScreenColumn {
        Spacer(Modifier.height(16.dp))
        Text(
            "Imprima os pedidos da sua loja automaticamente",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            "Este aparelho fica conectado à sua loja Venduá e imprime cada pedido nas impressoras térmicas " +
                "ligadas a ele por Bluetooth, USB ou rede.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Step(1, "Toque em “Conectar à loja” para gerar um código.")
                Step(2, "No painel da loja, aprove o código (ou leia o QR code com o celular).")
                Step(3, "Pronto: deixe este aparelho ligado e com internet perto das impressoras.")
            }
        }
        Spacer(Modifier.height(28.dp))
        Button(onClick = onConnect, modifier = Modifier.fillMaxWidth().height(BigButtonHeight)) {
            Text("Conectar à loja", style = MaterialTheme.typography.titleMedium)
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Step(n: Int, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(32.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Text("$n", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }
        Spacer(Modifier.width(14.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
fun PairingScreen(state: PairingUi, onRetry: () -> Unit, onCancel: () -> Unit) {
    ScreenColumn {
        when (state) {
            PairingUi.Idle, PairingUi.Starting -> Column(
                Modifier.fillMaxWidth().padding(top = 64.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator()
                Spacer(Modifier.height(16.dp))
                Text("Gerando código…", style = MaterialTheme.typography.bodyLarge)
            }
            is PairingUi.Showing -> ShowingCode(state, onCancel)
            PairingUi.Expired -> Problem(
                title = "Código expirou",
                body = "O código vale por 10 minutos. Gere um novo e aprove no painel da loja.",
                action = "Gerar novo código",
                onAction = onRetry,
                onCancel = onCancel,
            )
            is PairingUi.Error -> Problem(
                title = "Não deu certo",
                body = state.message,
                action = "Tentar de novo",
                onAction = onRetry,
                onCancel = onCancel,
            )
        }
    }
}

@Composable
private fun ShowingCode(state: PairingUi.Showing, onCancel: () -> Unit) {
    val context = LocalContext.current
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state.expiresAt) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val remaining = ((state.expiresAt - now) / 1_000).coerceAtLeast(0)

    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val wide = maxWidth >= 600.dp
        val code: @Composable () -> Unit = {
            Column(horizontalAlignment = if (wide) Alignment.Start else Alignment.CenterHorizontally) {
                Text(
                    "No painel da loja, em Impressoras, digite este código:",
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = if (wide) TextAlign.Start else TextAlign.Center,
                )
                Spacer(Modifier.height(16.dp))
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Text(
                        state.userCode,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 44.sp,
                        letterSpacing = 4.sp,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier
                            .padding(horizontal = 24.dp, vertical = 14.dp)
                            .semantics { contentDescription = "Código ${state.userCode.toList().joinToString(" ")}" },
                    )
                }
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "Aguardando aprovação · expira em ${String.format(Locale.ROOT, "%d:%02d", remaining / 60, remaining % 60)}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        val qr: @Composable () -> Unit = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                QrCode(state.approveUrl)
                Spacer(Modifier.height(8.dp))
                Text(
                    "Ou leia com o celular em que você usa o painel",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.width(220.dp),
                )
            }
        }
        Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
            if (wide) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                    Column(Modifier.weight(1f)) { code() }
                    qr()
                }
            } else {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    code()
                    Spacer(Modifier.height(24.dp))
                    qr()
                }
            }
            Spacer(Modifier.height(28.dp))
            OutlinedButton(
                onClick = { context.openUrl(state.approveUrl) },
                modifier = Modifier.fillMaxWidth().height(BigButtonHeight),
            ) { Text("Abrir no navegador", style = MaterialTheme.typography.titleMedium) }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Voltar") }
        }
    }
}

@Composable
private fun Problem(title: String, body: String, action: String, onAction: () -> Unit, onCancel: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 32.dp)) {
        Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(body, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(24.dp))
        Button(onClick = onAction, modifier = Modifier.fillMaxWidth().height(BigButtonHeight)) {
            Text(action, style = MaterialTheme.typography.titleMedium)
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Voltar") }
    }
}
