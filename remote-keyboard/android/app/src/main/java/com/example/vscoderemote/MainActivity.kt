package com.example.vscoderemote

import android.content.Context
import android.os.Vibrator
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.Icons
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import com.example.vscoderemote.network.*

// Define Shortcut Categories
data class VSShortcut(val label: String, val keys: List<String>, val category: String)

val shortcuts = listOf(
    // Basic
    VSShortcut("Copy", listOf("ctrl", "c"), "Basic"),
    VSShortcut("Paste", listOf("ctrl", "v"), "Basic"),
    VSShortcut("Save", listOf("ctrl", "s"), "Basic"),
    // Command
    VSShortcut("Command Palette", listOf("ctrl", "shift", "p"), "Command"),
    VSShortcut("Settings", listOf("ctrl", ","), "Command"),
    // Navigation
    VSShortcut("Go Back", listOf("alt", "left"), "Navigation"),
    VSShortcut("Find", listOf("ctrl", "f"), "Search"),
    // ... add more from your list here
)

@Composable
fun MainScreen(context: Context) {
    var ipAddress by remember { mutableStateOf("192.168.1.5") }
    var searchQuery by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        // IP Configuration
        OutlinedTextField(
            value = ipAddress,
            onValueChange = { ipAddress = it },
            label = { Text("PC IP Address") },
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(8.dp))

        // Search Bar
        TextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            placeholder = { Text("Search Shortcut...") },
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Shortcut Grid
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val filtered = shortcuts.filter { it.label.contains(searchQuery, true) }
            
            items(filtered) { shortcut ->
                Button(
                    onClick = {
                        vibrator.vibrate(50) // Native feedback
                        scope.launch {
                            try {
                                // Logic to call PC server
                                sendCommandToPc(ipAddress, shortcut.keys)
                            } catch (e: Exception) {
                                // Show Toast error
                            }
                        }
                    },
                    modifier = Modifier.height(80.dp),
                    shape = MaterialTheme.shapes.medium
                ) {
                    Text(shortcut.label, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}

suspend fun sendCommandToPc(ip: String, keys: List<String>) {
    // Boilerplate retrofit call here using http://$ip:5000
}
