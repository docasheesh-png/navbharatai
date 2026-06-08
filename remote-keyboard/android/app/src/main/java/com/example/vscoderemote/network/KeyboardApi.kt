package com.example.vscoderemote.network

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

data class ShortcutRequest(val keys: List<String>)

interface KeyboardApi {
    @POST("/press")
    suspend fun pressKeys(@Body request: ShortcutRequest): Response<Unit>
}
